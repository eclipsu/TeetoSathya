import type { JuryResult, TeamIndex } from '@teeto/shared';
import type { FactCheckChallenge, Participant, Room } from '../domain/model';
import { spacetimeConnection } from './hosted';

const pending = new Map<string, Room>();
let timer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
/** Set when the hosted module predates the claim_idea table; stops retrying until restart. */
let ideaTableMissing = false;

function sideName(team: TeamIndex | null, role: Participant['role']): string {
  if (role === 'spectator') return 'SPECTATOR';
  if (role === 'speaker' && team === 0) return 'TEAM_A';
  if (role === 'speaker' && team === 1) return 'TEAM_B';
  return 'UNSEATED';
}

function verdictOf(model: 'gemini' | 'claude', jury: JuryResult | null): { verdict: string; confidence: number } {
  const vote = jury?.votes.find((item) => item.model === model);
  if (!vote) return { verdict: '', confidence: 0 };
  return { verdict: vote.finalVerdict, confidence: vote.finalConfidence };
}

function outcomeName(check: FactCheckChallenge): string {
  if (check.outcome === 'successful') return 'SUCCESSFUL';
  if (check.outcome === 'failed') return 'FAILED';
  if (check.outcome === 'no_decision') return 'NO_DECISION';
  return 'NONE';
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'reducer failed';
  return message.replace(/eyJ[A-Za-z0-9_-]+/g, '[token]').slice(0, 180);
}

/** Queue a durable copy of this room. Writes run one at a time so an older copy cannot land last. */
export function persistRoom(room: Room): void {
  pending.set(room.id, room);
  if (timer || writing) return;
  timer = setTimeout(() => {
    void flush();
  }, 200);
}

async function flush(): Promise<void> {
  timer = null;
  writing = true;
  const rooms = [...pending.values()];
  pending.clear();
  for (const item of rooms) await writeRoom(item);
  writing = false;
  if (pending.size === 0) return;
  timer = setTimeout(() => {
    void flush();
  }, 200);
}

async function writeRoom(room: Room): Promise<void> {
  const conn = await spacetimeConnection();
  if (!conn) return;
  const participants = [...room.participants.values()];
  const segments = [...room.game.segments];
  const claims = [...room.game.claims];
  const checks = [...room.game.factChecks];
  const scores: [number, number] = [room.game.scores[0] ?? 0, room.game.scores[1] ?? 0];
  const host = participants.find((person) => person.sessionId === room.hostSessionId);
  try {
    await conn.reducers.recordRoom({
      roomId: room.id,
      topic: room.topic,
      status: room.status.toUpperCase(),
      teamALabel: room.sides[0],
      teamBLabel: room.sides[1],
      hostToken: room.hostToken,
      hostParticipantId: host?.id ?? '',
      createdAtMs: BigInt(room.createdAt),
      turnSeconds: room.settings.turnSeconds,
      roundSeconds: room.settings.roundSeconds,
      speakersPerTeamMax: room.settings.speakersPerTeamMax,
    });
    for (const person of participants) {
      await conn.reducers.recordParticipant({
        participantId: person.id,
        roomId: room.id,
        sessionId: person.sessionId,
        displayName: person.username,
        role: sideName(person.team, person.role),
        queuePosition: person.seatOrder ?? 0,
        connected: person.connected,
        joinedAtMs: BigInt(person.joinedAt),
        timeUsedMs: BigInt(person.timeUsedMs),
      });
    }
    if (room.game.roundSeq > 0) {
      const winner = scores[0] === scores[1] ? 'DRAW' : scores[0] > scores[1] ? 'TEAM_A' : 'TEAM_B';
      const complete = room.status === 'ended';
      await conn.reducers.recordRound({
        roundId: `${room.id}:${room.game.roundSeq}`,
        roomId: room.id,
        seq: room.game.roundSeq,
        status: complete ? 'COMPLETE' : 'ACTIVE',
        startedAtMs: BigInt(room.createdAt),
        endedAtMs: complete ? BigInt(Date.now()) : 0n,
        roundDurationMs: BigInt(room.settings.roundSeconds) * 1000n,
        winner: complete ? winner : 'NONE',
        scoreA: scores[0],
        scoreB: scores[1],
        phase: complete ? 'ROUND_COMPLETE' : checks.some((check) => check.status === 'checking') ? 'FACT_CHECKING' : 'PLAYING',
      });
    }
    for (const segment of segments) {
      const speaker = room.participants.get(segment.speakerSessionId);
      if (!speaker) continue;
      await conn.reducers.recordTranscript({
        id: segment.id,
        roomId: room.id,
        roundId: `${room.id}:${segment.roundSeq}`,
        speakerId: speaker.id,
        side: sideName(segment.team, 'speaker'),
        text: segment.text,
        createdAtMs: BigInt(segment.at),
      });
    }
    for (const claim of claims) {
      const speaker = room.participants.get(claim.speakerSessionId);
      if (!speaker) continue;
      await conn.reducers.recordClaim({
        id: claim.id,
        roomId: room.id,
        roundId: `${room.id}:${claim.roundSeq}`,
        speakerId: speaker.id,
        side: sideName(claim.team, 'speaker'),
        claim: claim.text,
        originalText: claim.originalText,
        createdAtMs: BigInt(claim.createdAt),
      });
      // The idea's live state in the speaker's buffer: latest wording, relevance, eviction.
      // Isolated: a database not yet re-published without claim_idea must not block the rest of the history.
      if (!ideaTableMissing) await conn.reducers.recordClaimIdea({
        claimId: claim.id,
        roomId: room.id,
        roundId: `${room.id}:${claim.roundSeq}`,
        speakerId: speaker.id,
        text: claim.text,
        relevance: claim.relevance,
        admittedAtMs: BigInt(claim.createdAt),
        updatedAtMs: BigInt(claim.updatedAt ?? 0),
        evictedAtMs: BigInt(claim.evictedAt ?? 0),
      }).catch((err: unknown) => {
        ideaTableMissing = true;
        console.warn('[spacetime] claim buffer not recorded (re-publish the module to add claim_idea):', safeError(err));
      });
    }
    for (const check of checks) {
      const gemini = verdictOf('gemini', check.jury);
      const claude = verdictOf('claude', check.jury);
      await conn.reducers.recordFactCheck({
        id: check.id,
        roomId: room.id,
        roundId: `${room.id}:${check.roundSeq}`,
        challengerId: check.challengerId,
        challengingSide: sideName(check.challengerTeam, 'speaker'),
        speakerId: check.speakerId,
        speakerSide: sideName(check.speakerTeam, 'speaker'),
        claimId: check.claimId,
        claimText: check.claim,
        status: check.status === 'resolved' ? 'RESOLVED' : 'CHECKING',
        finalVerdict: check.verdict ?? 'NONE',
        challengeOutcome: outcomeName(check),
        scoreDelta: check.scoreDelta ?? 0,
        scoreA: scores[0],
        scoreB: scores[1],
        createdAtMs: BigInt(check.createdAt),
        resolvedAtMs: check.status === 'resolved' ? BigInt(Date.now()) : 0n,
        geminiVerdict: gemini.verdict,
        geminiConfidence: gemini.confidence,
        claudeVerdict: claude.verdict,
        claudeConfidence: claude.confidence,
      });
    }
  } catch (err) {
    console.warn('[spacetime] history write failed:', safeError(err));
  }
}
