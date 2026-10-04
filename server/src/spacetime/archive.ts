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

/**
 * What was last sent per room, by row key → signature. Rows are re-sent only when they change, so a
 * long debate doesn't re-upload its whole history on every update (matters with many rooms live).
 */
const sent = new Map<string, Map<string, string>>();
function changed(roomId: string, key: string, row: unknown): boolean {
  const sig = JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  let rows = sent.get(roomId);
  if (!rows) sent.set(roomId, (rows = new Map()));
  if (rows.get(key) === sig) return false;
  rows.set(key, sig);
  return true;
}
/** A write failed: forget the signature so the row is retried on the next change. */
function unsent(roomId: string, key: string): void {
  sent.get(roomId)?.delete(key);
}

function phaseOf(room: Room): string {
  const g = room.game;
  if (room.status === 'lobby') return 'LOBBY';
  if (room.status === 'ended') return 'ENDED';
  if (g.intermission) return 'BREAK';
  const active = g.activeFactCheckId ? g.factChecks.find((f) => f.id === g.activeFactCheckId) : undefined;
  if (active?.status === 'tiebreak') return 'TIEBREAK';
  if (active) return 'FACT_CHECK';
  return 'LIVE';
}

function winnerName(room: Room): string {
  const w = room.game.winner;
  if (room.status !== 'ended') return 'NONE';
  return w === 0 ? 'TEAM_A' : w === 1 ? 'TEAM_B' : w === 'draw' ? 'DRAW' : 'NONE';
}

/** The live-index row for this room: everything a lobby card or board header needs. */
function liveRow(room: Room) {
  const g = room.game;
  const people = [...room.participants.values()];
  const speaker = g.activeSide !== null && g.hotSeat[g.activeSide] ? room.participants.get(g.hotSeat[g.activeSide]!) : undefined;
  return {
    roomId: room.id,
    topic: room.topic,
    teamALabel: room.sides[0],
    teamBLabel: room.sides[1],
    phase: phaseOf(room),
    round: g.roundNumber,
    totalRounds: room.settings.totalRounds,
    scoreA: g.scores[0] ?? 0,
    scoreB: g.scores[1] ?? 0,
    speakerName: room.status === 'live' ? speaker?.username ?? '' : '',
    speakerSide: room.status === 'live' && speaker ? sideName(speaker.team, speaker.role) : 'NONE',
    roundClaim: g.roundClaim?.text ?? '',
    players: people.filter((p) => p.role === 'speaker').length,
    listeners: people.filter((p) => p.connected).length,
    winner: winnerName(room),
  };
}

const RECENT_LINES = 8;
const RECENT_VERDICTS = 5;
/** The debate's rolling context: last lines spoken this round and the latest verdicts. */
function contextRow(room: Room) {
  const g = room.game;
  const name = (sid: string) => room.participants.get(sid)?.username ?? 'Someone';
  const lines = g.segments.filter((s) => s.roundSeq === g.roundSeq).slice(-RECENT_LINES).map((s) => `${name(s.speakerSessionId)}: ${s.text}`);
  const verdicts = [...g.factChecks].reverse().slice(0, RECENT_VERDICTS).map((f) => {
    const result = f.status === 'checking' ? 'checking' : f.status === 'tiebreak' ? 'jury split, host deciding'
      : `${f.verdict ?? 'no decision'}${f.decidedByHost ? ' (host ruled)' : ''}${f.scoreDelta ? ` ${f.scoreDelta > 0 ? '+' : ''}${f.scoreDelta}` : ''}`;
    return `${f.challengerName} challenged ${f.speakerName}: ${f.claim} → ${result}`;
  });
  return { roomId: room.id, recentLines: lines.join('\n'), recentVerdicts: verdicts.join('\n') };
}

/** Room closed: remove it from the live index and forget what was sent. History rows stay. */
export async function dropRoom(roomId: string): Promise<void> {
  pending.delete(roomId);
  sent.delete(roomId);
  const conn = await spacetimeConnection();
  if (!conn) return;
  try {
    await conn.reducers.dropLiveDebate({ roomId });
  } catch (err) {
    console.warn('[spacetime] live index drop failed:', safeError(err));
  }
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
  const now = BigInt(Date.now());
  // Live index and context first: small rows, and what the lobby and live board read.
  try {
    const live = liveRow(room);
    if (changed(room.id, 'live', live)) await conn.reducers.upsertLiveDebate({ ...live, updatedAtMs: now }).catch((err: unknown) => { unsent(room.id, 'live'); throw err; });
    const ctx = contextRow(room);
    if (changed(room.id, 'context', ctx)) await conn.reducers.upsertDebateContext({ ...ctx, updatedAtMs: now }).catch((err: unknown) => { unsent(room.id, 'context'); throw err; });
  } catch (err) {
    console.warn('[spacetime] live index write failed:', safeError(err));
  }
  try {
    const roomRow = {
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
    };
    if (changed(room.id, 'room', roomRow)) await conn.reducers.recordRoom(roomRow);
    for (const person of participants) {
      const row = {
        participantId: person.id,
        roomId: room.id,
        sessionId: person.sessionId,
        displayName: person.username,
        role: sideName(person.team, person.role),
        queuePosition: person.seatOrder ?? 0,
        connected: person.connected,
        joinedAtMs: BigInt(person.joinedAt),
        timeUsedMs: BigInt(person.timeUsedMs),
      };
      if (changed(room.id, `p:${person.id}`, row)) await conn.reducers.recordParticipant(row);
    }
    if (room.game.roundSeq > 0) {
      const winner = scores[0] === scores[1] ? 'DRAW' : scores[0] > scores[1] ? 'TEAM_A' : 'TEAM_B';
      const complete = room.status === 'ended';
      const row = {
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
      };
      // endedAtMs is stamped "now": leave it out of the signature so the row isn't re-sent on every change.
      if (changed(room.id, `round:${row.roundId}`, { ...row, endedAtMs: complete })) await conn.reducers.recordRound(row);
    }
    for (const segment of segments) {
      const speaker = room.participants.get(segment.speakerSessionId);
      if (!speaker) continue;
      if (!changed(room.id, `seg:${segment.id}`, segment.text)) continue;
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
      if (changed(room.id, `claim:${claim.id}`, claim.originalText)) await conn.reducers.recordClaim({
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
      const idea = { text: claim.text, relevance: claim.relevance, updatedAt: claim.updatedAt, evictedAt: claim.evictedAt };
      if (!ideaTableMissing && changed(room.id, `idea:${claim.id}`, idea)) await conn.reducers.recordClaimIdea({
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
        unsent(room.id, `idea:${claim.id}`);
        ideaTableMissing = true;
        console.warn('[spacetime] claim buffer not recorded (re-publish the module to add claim_idea):', safeError(err));
      });
    }
    for (const check of checks) {
      const gemini = verdictOf('gemini', check.jury);
      const claude = verdictOf('claude', check.jury);
      const row = {
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
      };
      // resolvedAtMs is stamped "now" and the score fields follow the live total: keep them out of the signature.
      if (changed(room.id, `fc:${check.id}`, { ...row, resolvedAtMs: check.status, scoreA: 0, scoreB: 0 })) await conn.reducers.recordFactCheck(row);
    }
  } catch (err) {
    sent.delete(room.id); // resend everything for this room on the next change
    console.warn('[spacetime] history write failed:', safeError(err));
  }
}
