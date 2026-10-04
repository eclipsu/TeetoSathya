import { Identity, ScheduleAt } from 'spacetimedb';
import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { scheduleReady, scheduleRound } from './schema';

export { default } from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const READY_MS = 10_000n;

function nowMs(ctx: Ctx): bigint {
  return ctx.timestamp.microsSinceUnixEpoch / 1000n;
}

/**
 * The login that published tetosatya-tg079. The database has a different identity,
 * so comparing the caller to that identity rejects the owner.
 * Scheduled reducers still run as the database identity.
 */
const OWNER = Identity.fromString('c20002bab8da1ad231e9177ff895c3095c3668655cb3f8df29229d651b37dbfc');

function assertOwner(ctx: Ctx): void {
  if (ctx.sender.equals(OWNER) || ctx.sender.equals(ctx.databaseIdentity)) return;
  throw new SenderError('unauthorized');
}

function event(ctx: Ctx, roomId: string, roundId: string, type: string, participantId = '', side = '', points = 0): void {
  ctx.db.gameEvent.insert({
    id: 0n,
    roomId,
    roundId,
    type,
    participantId,
    side,
    points,
    createdAtMs: nowMs(ctx),
  });
}

function clearSchedules(ctx: Ctx, roomId: string): void {
  ctx.db.scheduleReady.by_room.delete(roomId);
  ctx.db.scheduleRound.by_room.delete(roomId);
}

function scheduleRoundEnd(ctx: Ctx, roomId: string, endsAtMs: bigint): void {
  ctx.db.scheduleRound.by_room.delete(roomId);
  if (endsAtMs <= 0n) return;
  ctx.db.scheduleRound.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(endsAtMs * 1000n),
    roomId,
  });
}

function speakers(ctx: Ctx, roomId: string, side: string) {
  return [...ctx.db.participant.by_room.filter(roomId)]
    .filter((p) => p.role === side)
    .sort((a, b) => a.queuePosition - b.queuePosition);
}

function queueRows(ctx: Ctx, roundId: string, side: string) {
  return [...ctx.db.speakerQueue.by_round_side.filter([roundId, side])].sort((a, b) => a.position - b.position);
}

function rewriteQueue(ctx: Ctx, roundId: string, side: string, ids: string[]): void {
  for (const row of queueRows(ctx, roundId, side)) ctx.db.speakerQueue.id.delete(row.id);
  ids.forEach((participantId, index) => {
    ctx.db.speakerQueue.insert({
      id: 0n,
      queueKey: `${roundId}:${side}:${index + 1}`,
      roundId,
      side,
      position: index + 1,
      participantId,
    });
  });
}

function remainingOf(ctx: Ctx, roundId: string, participantId: string): bigint {
  return ctx.db.speakerState.stateKey.find(`${roundId}:${participantId}`)?.remainingMs ?? 0n;
}

function setRemaining(ctx: Ctx, roundId: string, participantId: string, remainingMs: bigint): void {
  const row = ctx.db.speakerState.stateKey.find(`${roundId}:${participantId}`);
  if (!row) return;
  ctx.db.speakerState.id.update({ ...row, remainingMs: remainingMs < 0n ? 0n : remainingMs });
}

function settle(ctx: Ctx, roomId: string): void {
  const state = ctx.db.gameState.roomId.find(roomId);
  if (!state || state.phase !== 'PLAYING' || state.speakerStartedAtMs === 0n || !state.activeSpeakerId) return;
  const now = nowMs(ctx);
  const elapsed = now > state.speakerStartedAtMs ? now - state.speakerStartedAtMs : 0n;
  const left = remainingOf(ctx, state.roundId, state.activeSpeakerId);
  const charged = elapsed < left ? elapsed : left;
  setRemaining(ctx, state.roundId, state.activeSpeakerId, left - charged);
  const speaker = ctx.db.participant.participantId.find(state.activeSpeakerId);
  if (speaker) ctx.db.participant.participantId.update({ ...speaker, timeUsedMs: speaker.timeUsedMs + charged });
  const roundLeft = state.roundEndsAtMs > now ? state.roundEndsAtMs - now : 0n;
  ctx.db.gameState.roomId.update({ ...state, speakerStartedAtMs: now, roundRemainingMs: roundLeft });
}

function freeze(ctx: Ctx, roomId: string): void {
  settle(ctx, roomId);
  const state = ctx.db.gameState.roomId.find(roomId);
  if (!state) return;
  const now = nowMs(ctx);
  const roundRemainingMs = state.roundEndsAtMs > now ? state.roundEndsAtMs - now : state.roundRemainingMs;
  ctx.db.gameState.roomId.update({
    ...ctx.db.gameState.roomId.find(roomId)!,
    speakerStartedAtMs: 0n,
    roundEndsAtMs: 0n,
    roundRemainingMs,
    paused: true,
  });
  clearSchedules(ctx, roomId);
}

function resumePlaying(ctx: Ctx, roomId: string, speakerId: string, side: string): void {
  const state = ctx.db.gameState.roomId.find(roomId);
  if (!state) return;
  const now = nowMs(ctx);
  const roundEndsAtMs = now + state.roundRemainingMs;
  ctx.db.gameState.roomId.update({
    ...state,
    phase: 'PLAYING',
    activeSide: side,
    activeSpeakerId: speakerId,
    speakerStartedAtMs: now,
    roundEndsAtMs,
    readySpeakerId: '',
    readyEndsAtMs: 0n,
    activeFactCheckId: '',
    paused: false,
  });
  scheduleRoundEnd(ctx, roomId, roundEndsAtMs);
}

export const init = spacetimedb.init(_ctx => {});
export const onConnect = spacetimedb.clientConnected(_ctx => {});
export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

export const createRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    topic: t.string(),
    teamALabel: t.string(),
    teamBLabel: t.string(),
    hostToken: t.string(),
    hostParticipantId: t.string(),
    hostSessionId: t.string(),
    hostName: t.string(),
    turnSeconds: t.i32(),
    roundSeconds: t.i32(),
    speakersPerTeamMax: t.i32(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    if (ctx.db.room.roomId.find(args.roomId)) throw new SenderError('room exists');
    const now = nowMs(ctx);
    ctx.db.room.insert({
      roomId: args.roomId,
      topic: args.topic,
      status: 'LOBBY',
      teamALabel: args.teamALabel,
      teamBLabel: args.teamBLabel,
      createdAtMs: now,
      turnSeconds: args.turnSeconds,
      roundSeconds: args.roundSeconds,
      speakersPerTeamMax: args.speakersPerTeamMax,
    });
    ctx.db.roomSecret.insert({
      roomId: args.roomId,
      hostToken: args.hostToken,
      hostParticipantId: args.hostParticipantId,
    });
    ctx.db.participant.insert({
      participantId: args.hostParticipantId,
      roomId: args.roomId,
      displayName: args.hostName,
      role: 'UNSEATED',
      queuePosition: 0,
      connected: true,
      joinedAtMs: now,
      timeUsedMs: 0n,
    });
    ctx.db.participantSecret.insert({ participantId: args.hostParticipantId, sessionId: args.hostSessionId });
    ctx.db.gameState.insert({
      roomId: args.roomId,
      roundId: '',
      phase: 'LOBBY',
      activeSide: 'NONE',
      activeSpeakerId: '',
      scoreA: 0,
      scoreB: 0,
      roundEndsAtMs: 0n,
      roundRemainingMs: BigInt(args.roundSeconds) * 1000n,
      speakerStartedAtMs: 0n,
      readySpeakerId: '',
      readyEndsAtMs: 0n,
      activeFactCheckId: '',
      paused: false,
    });
  },
);

export const joinRoom = spacetimedb.reducer(
  { roomId: t.string(), participantId: t.string(), sessionId: t.string(), displayName: t.string() },
  (ctx, args) => {
    assertOwner(ctx);
    if (!ctx.db.room.roomId.find(args.roomId)) throw new SenderError('room not found');
    const existing = ctx.db.participantSecret.sessionId.find(args.sessionId);
    if (existing) {
      const person = ctx.db.participant.participantId.find(existing.participantId);
      if (person) ctx.db.participant.participantId.update({ ...person, connected: true, displayName: args.displayName });
      return;
    }
    ctx.db.participant.insert({
      participantId: args.participantId,
      roomId: args.roomId,
      displayName: args.displayName,
      role: 'UNSEATED',
      queuePosition: 0,
      connected: true,
      joinedAtMs: nowMs(ctx),
      timeUsedMs: 0n,
    });
    ctx.db.participantSecret.insert({ participantId: args.participantId, sessionId: args.sessionId });
  },
);

export const setRole = spacetimedb.reducer(
  { participantId: t.string(), role: t.string() },
  (ctx, { participantId, role }) => {
    assertOwner(ctx);
    const person = ctx.db.participant.participantId.find(participantId);
    if (!person) throw new SenderError('participant not found');
    if (role !== 'TEAM_A' && role !== 'TEAM_B' && role !== 'SPECTATOR') throw new SenderError('unknown role');
    const mates = speakers(ctx, person.roomId, role);
    ctx.db.participant.participantId.update({
      ...person,
      role,
      queuePosition: role === 'SPECTATOR' ? 0 : mates.length + 1,
    });
  },
);

export const startRound = spacetimedb.reducer({ roomId: t.string() }, (ctx, { roomId }) => {
  assertOwner(ctx);
  const room = ctx.db.room.roomId.find(roomId);
  const state = ctx.db.gameState.roomId.find(roomId);
  if (!room || !state) throw new SenderError('room not found');
  if (state.phase !== 'LOBBY' && state.phase !== 'ROUND_COMPLETE') throw new SenderError('round already started');
  const teamA = speakers(ctx, roomId, 'TEAM_A');
  const teamB = speakers(ctx, roomId, 'TEAM_B');
  if (!teamA.length || !teamB.length) throw new SenderError('both teams need a speaker');
  const seq = [...ctx.db.round.by_room.filter(roomId)].reduce((max, row) => Math.max(max, row.seq), 0) + 1;
  const roundId = `${roomId}:${seq}`;
  const now = nowMs(ctx);
  const budget = BigInt(room.turnSeconds) * 1000n;
  const duration = BigInt(room.roundSeconds) * 1000n;
  ctx.db.round.insert({
    roundId,
    roomId,
    seq,
    status: 'ACTIVE',
    startedAtMs: now,
    endedAtMs: 0n,
    roundDurationMs: duration,
    winner: 'NONE',
    finalScoreA: 0,
    finalScoreB: 0,
  });
  for (const person of [...teamA, ...teamB]) {
    ctx.db.participant.participantId.update({ ...person, timeUsedMs: 0n });
    ctx.db.speakerState.insert({
      id: 0n,
      stateKey: `${roundId}:${person.participantId}`,
      roundId,
      participantId: person.participantId,
      remainingMs: budget,
    });
  }
  rewriteQueue(ctx, roundId, 'TEAM_A', teamA.map((p) => p.participantId));
  rewriteQueue(ctx, roundId, 'TEAM_B', teamB.map((p) => p.participantId));
  const opener = teamA[0]!;
  ctx.db.room.roomId.update({ ...room, status: 'LIVE' });
  ctx.db.gameState.roomId.update({
    ...state,
    roundId,
    phase: 'PLAYING',
    activeSide: 'TEAM_A',
    activeSpeakerId: opener.participantId,
    scoreA: 0,
    scoreB: 0,
    roundEndsAtMs: now + duration,
    roundRemainingMs: duration,
    speakerStartedAtMs: now,
    readySpeakerId: '',
    readyEndsAtMs: 0n,
    activeFactCheckId: '',
    paused: false,
  });
  scheduleRoundEnd(ctx, roomId, now + duration);
  event(ctx, roomId, roundId, 'ROUND_STARTED', opener.participantId, 'TEAM_A');
});

export const submitFactCheck = spacetimedb.reducer(
  { factCheckId: t.string(), challengerId: t.string(), claimId: t.string() },
  (ctx, { factCheckId, challengerId, claimId }) => {
    assertOwner(ctx);
    const challenger = ctx.db.participant.participantId.find(challengerId);
    if (!challenger) throw new SenderError('challenger not found');
    const state = ctx.db.gameState.roomId.find(challenger.roomId);
    const roomRound = state ? ctx.db.round.roundId.find(state.roundId) : undefined;
    if (!state || !roomRound || roomRound.status !== 'ACTIVE') throw new SenderError('round not found');
    if (state.phase !== 'PLAYING') throw new SenderError('fact check is only available while playing');
    if (state.activeFactCheckId) throw new SenderError('a fact check is already active');
    if (challenger.participantId === state.activeSpeakerId) throw new SenderError('the speaker cannot fact-check');
    const challengingSide = challenger.role;
    if (challengingSide !== 'TEAM_A' && challengingSide !== 'TEAM_B') throw new SenderError('only a team speaker can fact-check');
    if (challengingSide === state.activeSide) throw new SenderError('cannot fact-check your own side');
    const usageKey = `${state.roundId}:${challenger.participantId}`;
    if (ctx.db.factCheckUsage.usageKey.find(usageKey)) throw new SenderError('fact check already used');
    const found = ctx.db.claim.id.find(claimId);
    if (!found || found.roundId !== state.roundId || found.speakerId !== state.activeSpeakerId) {
      throw new SenderError('claim is not from the current speaker');
    }
    freeze(ctx, challenger.roomId);
    const frozen = ctx.db.gameState.roomId.find(challenger.roomId)!;
    ctx.db.factCheck.insert({
      id: factCheckId,
      roomId: challenger.roomId,
      roundId: state.roundId,
      challengerId: challenger.participantId,
      challengingSide,
      speakerId: state.activeSpeakerId,
      speakerSide: state.activeSide,
      claimId: found.id,
      claimText: found.claim,
      status: 'CHECKING',
      finalVerdict: 'NONE',
      challengeOutcome: 'NONE',
      scoreDelta: 0,
      speakerRotated: false,
      nextSpeakerId: '',
      createdAtMs: nowMs(ctx),
      resolvedAtMs: 0n,
    });
    ctx.db.factCheckUsage.insert({
      id: 0n,
      usageKey,
      roundId: state.roundId,
      participantId: challenger.participantId,
      factCheckId,
      usedAtMs: nowMs(ctx),
    });
    ctx.db.gameState.roomId.update({ ...frozen, phase: 'FACT_CHECKING', activeFactCheckId: factCheckId });
    event(ctx, challenger.roomId, state.roundId, 'FACT_CHECK_SUBMITTED', challenger.participantId, challengingSide);
  },
);

function rotateSpeaker(ctx: Ctx, roundId: string, side: string, speakerId: string): string {
  const ids = queueRows(ctx, roundId, side).map((row) => row.participantId);
  const index = ids.indexOf(speakerId);
  if (index < 0) return '';
  const rotated = [...ids.slice(index + 1), ...ids.slice(0, index)];
  const next = rotated.find((id) => remainingOf(ctx, roundId, id) > 0n) ?? '';
  if (!next) return '';
  const rest = rotated.filter((id) => id !== next);
  rewriteQueue(ctx, roundId, side, [next, ...rest, speakerId]);
  return next;
}

export const resolveFactCheck = spacetimedb.reducer(
  {
    factCheckId: t.string(),
    finalVerdict: t.string(),
    geminiVerdict: t.string(),
    geminiConfidence: t.f64(),
    claudeVerdict: t.string(),
    claudeConfidence: t.f64(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    const check = ctx.db.factCheck.id.find(args.factCheckId);
    if (!check) throw new SenderError('fact check not found');
    if (check.status !== 'CHECKING' && check.status !== 'PENDING') throw new SenderError('fact check already resolved');
    const state = ctx.db.gameState.roomId.find(check.roomId);
    if (!state || state.roundId !== check.roundId) throw new SenderError('round mismatch');
    if (args.geminiVerdict === 'CORRECT' || args.geminiVerdict === 'INCORRECT') {
      ctx.db.factCheckVote.insert({
        id: 0n,
        voteKey: `${check.id}:GEMINI`,
        factCheckId: check.id,
        provider: 'GEMINI',
        verdict: args.geminiVerdict,
        confidence: args.geminiConfidence,
      });
    }
    if (args.claudeVerdict === 'CORRECT' || args.claudeVerdict === 'INCORRECT') {
      ctx.db.factCheckVote.insert({
        id: 0n,
        voteKey: `${check.id}:CLAUDE`,
        factCheckId: check.id,
        provider: 'CLAUDE',
        verdict: args.claudeVerdict,
        confidence: args.claudeConfidence,
      });
    }
    let scoreDelta = 0;
    let outcome = 'NO_DECISION';
    let nextSpeakerId = '';
    let speakerRotated = false;
    if (args.finalVerdict === 'INCORRECT') {
      scoreDelta = 100;
      outcome = 'SUCCESSFUL';
      nextSpeakerId = rotateSpeaker(ctx, check.roundId, check.speakerSide, check.speakerId);
      speakerRotated = nextSpeakerId !== '';
    } else if (args.finalVerdict === 'CORRECT') {
      scoreDelta = -50;
      outcome = 'FAILED';
    } else if (args.finalVerdict !== 'INCONCLUSIVE') {
      throw new SenderError('unknown verdict');
    }
    ctx.db.factCheck.id.update({
      ...check,
      status: 'RESOLVED',
      finalVerdict: args.finalVerdict,
      challengeOutcome: outcome,
      scoreDelta,
      speakerRotated,
      nextSpeakerId,
      resolvedAtMs: nowMs(ctx),
    });
    ctx.db.gameState.roomId.update({
      ...ctx.db.gameState.roomId.find(check.roomId)!,
      phase: 'VERDICT',
      scoreA: state.scoreA + (check.challengingSide === 'TEAM_A' ? scoreDelta : 0),
      scoreB: state.scoreB + (check.challengingSide === 'TEAM_B' ? scoreDelta : 0),
      readySpeakerId: nextSpeakerId,
    });
    event(
      ctx,
      check.roomId,
      check.roundId,
      outcome === 'SUCCESSFUL' ? 'FACT_CHECK_SUCCESSFUL' : outcome === 'FAILED' ? 'FACT_CHECK_FAILED' : 'FACT_CHECK_NO_DECISION',
      check.challengerId,
      check.challengingSide,
      scoreDelta,
    );
    if (speakerRotated) event(ctx, check.roomId, check.roundId, 'SPEAKER_ROTATED', nextSpeakerId, check.speakerSide);
  },
);

export const continueVerdict = spacetimedb.reducer({ roomId: t.string() }, (ctx, { roomId }) => {
  assertOwner(ctx);
  const state = ctx.db.gameState.roomId.find(roomId);
  if (!state || state.phase !== 'VERDICT' || !state.activeFactCheckId) throw new SenderError('no verdict to continue');
  const check = ctx.db.factCheck.id.find(state.activeFactCheckId);
  if (!check || check.status !== 'RESOLVED') throw new SenderError('fact check is not resolved');
  if (check.speakerRotated && check.nextSpeakerId) {
    const readyEndsAtMs = nowMs(ctx) + READY_MS;
    ctx.db.gameState.roomId.update({
      ...state,
      phase: 'GET_READY',
      readySpeakerId: check.nextSpeakerId,
      readyEndsAtMs,
      activeFactCheckId: '',
    });
    ctx.db.scheduleReady.by_room.delete(roomId);
    ctx.db.scheduleReady.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(readyEndsAtMs * 1000n),
      roomId,
    });
    event(ctx, roomId, state.roundId, 'SPEAKER_READY', check.nextSpeakerId, check.speakerSide);
    return;
  }
  resumePlaying(ctx, roomId, state.activeSpeakerId, state.activeSide);
});

export const finishReady = spacetimedb.reducer(
  { onSchedule: scheduleReady },
  { timer: scheduleReady.rowType },
  (ctx, { timer }) => {
    const state = ctx.db.gameState.roomId.find(timer.roomId);
    if (!state || state.phase !== 'GET_READY' || !state.readySpeakerId) return;
    const person = ctx.db.participant.participantId.find(state.readySpeakerId);
    if (!person) return;
    resumePlaying(ctx, timer.roomId, person.participantId, person.role);
    event(ctx, timer.roomId, state.roundId, 'TURN_CHANGED', person.participantId, person.role);
  },
);

function completeRound(ctx: Ctx, roomId: string): void {
  const state = ctx.db.gameState.roomId.find(roomId);
  const room = ctx.db.room.roomId.find(roomId);
  if (!state || !room || state.phase === 'ROUND_COMPLETE') return;
  settle(ctx, roomId);
  const latest = ctx.db.gameState.roomId.find(roomId)!;
  const winner = latest.scoreA > latest.scoreB ? 'TEAM_A' : latest.scoreB > latest.scoreA ? 'TEAM_B' : 'DRAW';
  const row = ctx.db.round.roundId.find(latest.roundId);
  if (row) {
    ctx.db.round.roundId.update({
      ...row,
      status: 'COMPLETE',
      endedAtMs: nowMs(ctx),
      winner,
      finalScoreA: latest.scoreA,
      finalScoreB: latest.scoreB,
    });
  }
  ctx.db.gameState.roomId.update({
    ...latest,
    phase: 'ROUND_COMPLETE',
    activeSide: 'NONE',
    activeSpeakerId: '',
    speakerStartedAtMs: 0n,
    roundEndsAtMs: 0n,
    readySpeakerId: '',
    readyEndsAtMs: 0n,
    activeFactCheckId: '',
    paused: false,
  });
  ctx.db.room.roomId.update({ ...room, status: 'ENDED' });
  clearSchedules(ctx, roomId);
  event(ctx, roomId, latest.roundId, 'ROUND_ENDED', '', winner);
}

export const finishRound = spacetimedb.reducer(
  { onSchedule: scheduleRound },
  { timer: scheduleRound.rowType },
  (ctx, { timer }) => {
    const state = ctx.db.gameState.roomId.find(timer.roomId);
    if (!state || state.phase !== 'PLAYING') return;
    if (state.roundEndsAtMs > nowMs(ctx)) return;
    completeRound(ctx, timer.roomId);
  },
);

export const endRound = spacetimedb.reducer({ roomId: t.string() }, (ctx, { roomId }) => {
  assertOwner(ctx);
  completeRound(ctx, roomId);
});

export const appendTranscript = spacetimedb.reducer(
  { id: t.string(), roomId: t.string(), speakerId: t.string(), text: t.string() },
  (ctx, args) => {
    assertOwner(ctx);
    const state = ctx.db.gameState.roomId.find(args.roomId);
    if (!state || state.phase !== 'PLAYING' || state.activeSpeakerId !== args.speakerId) return;
    const person = ctx.db.participant.participantId.find(args.speakerId);
    if (!person || !args.text.trim()) return;
    ctx.db.transcriptSegment.insert({
      id: args.id,
      roomId: args.roomId,
      roundId: state.roundId,
      speakerId: args.speakerId,
      side: person.role,
      text: args.text.trim(),
      createdAtMs: nowMs(ctx),
    });
  },
);

export const addClaim = spacetimedb.reducer(
  { id: t.string(), roomId: t.string(), speakerId: t.string(), claim: t.string(), originalText: t.string() },
  (ctx, args) => {
    assertOwner(ctx);
    const state = ctx.db.gameState.roomId.find(args.roomId);
    const person = ctx.db.participant.participantId.find(args.speakerId);
    if (!state || !person || !args.claim.trim()) return;
    const text = args.claim.trim();
    const dup = [...ctx.db.claim.by_round_speaker.filter([state.roundId, args.speakerId])].some((row) => row.claim === text);
    if (dup) return;
    ctx.db.claim.insert({
      id: args.id,
      roomId: args.roomId,
      roundId: state.roundId,
      speakerId: args.speakerId,
      side: person.role,
      claim: text,
      originalText: args.originalText.trim() || text,
      createdAtMs: nowMs(ctx),
    });
  },
);

function ensureGame(ctx: Ctx, roomId: string, roundSeconds: number): void {
  if (ctx.db.gameState.roomId.find(roomId)) return;
  ctx.db.gameState.insert({
    roomId,
    roundId: '',
    phase: 'LOBBY',
    activeSide: 'NONE',
    activeSpeakerId: '',
    scoreA: 0,
    scoreB: 0,
    roundEndsAtMs: 0n,
    roundRemainingMs: BigInt(roundSeconds) * 1000n,
    speakerStartedAtMs: 0n,
    readySpeakerId: '',
    readyEndsAtMs: 0n,
    activeFactCheckId: '',
    paused: false,
  });
}

/** Durable history. Does not depend on the live phase machine, so a recorded debate cannot be dropped. */
export const recordRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    topic: t.string(),
    status: t.string(),
    teamALabel: t.string(),
    teamBLabel: t.string(),
    hostToken: t.string(),
    hostParticipantId: t.string(),
    createdAtMs: t.i64(),
    turnSeconds: t.i32(),
    roundSeconds: t.i32(),
    speakersPerTeamMax: t.i32(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    const existing = ctx.db.room.roomId.find(args.roomId);
    if (!existing) {
      ctx.db.room.insert({
        roomId: args.roomId,
        topic: args.topic,
        status: args.status,
        teamALabel: args.teamALabel,
        teamBLabel: args.teamBLabel,
        createdAtMs: args.createdAtMs,
        turnSeconds: args.turnSeconds,
        roundSeconds: args.roundSeconds,
        speakersPerTeamMax: args.speakersPerTeamMax,
      });
      ctx.db.roomSecret.insert({
        roomId: args.roomId,
        hostToken: args.hostToken,
        hostParticipantId: args.hostParticipantId,
      });
      ensureGame(ctx, args.roomId, args.roundSeconds);
      event(ctx, args.roomId, '', 'ROOM_CREATED', args.hostParticipantId);
      return;
    }
    ctx.db.room.roomId.update({
      ...existing,
      topic: args.topic,
      status: args.status,
      teamALabel: args.teamALabel,
      teamBLabel: args.teamBLabel,
    });
  },
);

export const recordParticipant = spacetimedb.reducer(
  {
    participantId: t.string(),
    roomId: t.string(),
    sessionId: t.string(),
    displayName: t.string(),
    role: t.string(),
    queuePosition: t.i32(),
    connected: t.bool(),
    joinedAtMs: t.i64(),
    timeUsedMs: t.i64(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    if (!ctx.db.room.roomId.find(args.roomId)) throw new SenderError('room not found');
    const person = ctx.db.participant.participantId.find(args.participantId);
    if (!person) {
      ctx.db.participant.insert({
        participantId: args.participantId,
        roomId: args.roomId,
        displayName: args.displayName,
        role: args.role,
        queuePosition: args.queuePosition,
        connected: args.connected,
        joinedAtMs: args.joinedAtMs,
        timeUsedMs: args.timeUsedMs,
      });
      if (!ctx.db.participantSecret.sessionId.find(args.sessionId)) {
        ctx.db.participantSecret.insert({ participantId: args.participantId, sessionId: args.sessionId });
      }
      return;
    }
    ctx.db.participant.participantId.update({
      ...person,
      displayName: args.displayName,
      role: args.role,
      queuePosition: args.queuePosition,
      connected: args.connected,
      timeUsedMs: args.timeUsedMs,
    });
  },
);

export const recordRound = spacetimedb.reducer(
  {
    roundId: t.string(),
    roomId: t.string(),
    seq: t.i32(),
    status: t.string(),
    startedAtMs: t.i64(),
    endedAtMs: t.i64(),
    roundDurationMs: t.i64(),
    winner: t.string(),
    scoreA: t.i32(),
    scoreB: t.i32(),
    phase: t.string(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    if (!ctx.db.room.roomId.find(args.roomId)) throw new SenderError('room not found');
    ensureGame(ctx, args.roomId, 0);
    const existing = ctx.db.round.roundId.find(args.roundId);
    if (!existing) {
      ctx.db.round.insert({
        roundId: args.roundId,
        roomId: args.roomId,
        seq: args.seq,
        status: args.status,
        startedAtMs: args.startedAtMs,
        endedAtMs: args.endedAtMs,
        roundDurationMs: args.roundDurationMs,
        winner: args.winner,
        finalScoreA: args.scoreA,
        finalScoreB: args.scoreB,
      });
      event(ctx, args.roomId, args.roundId, 'ROUND_STARTED');
    } else {
      const ending = existing.status !== 'COMPLETE' && args.status === 'COMPLETE';
      ctx.db.round.roundId.update({
        ...existing,
        status: args.status,
        endedAtMs: existing.status === 'COMPLETE' && existing.endedAtMs > 0n ? existing.endedAtMs : args.endedAtMs,
        winner: args.winner,
        finalScoreA: args.scoreA,
        finalScoreB: args.scoreB,
      });
      if (ending) event(ctx, args.roomId, args.roundId, 'ROUND_ENDED', '', args.winner);
    }
    const state = ctx.db.gameState.roomId.find(args.roomId)!;
    ctx.db.gameState.roomId.update({
      ...state,
      roundId: args.roundId,
      phase: args.phase,
      scoreA: args.scoreA,
      scoreB: args.scoreB,
    });
  },
);

export const recordTranscript = spacetimedb.reducer(
  {
    id: t.string(),
    roomId: t.string(),
    roundId: t.string(),
    speakerId: t.string(),
    side: t.string(),
    text: t.string(),
    createdAtMs: t.i64(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    if (!args.text.trim() || ctx.db.transcriptSegment.id.find(args.id)) return;
    ctx.db.transcriptSegment.insert({
      id: args.id,
      roomId: args.roomId,
      roundId: args.roundId,
      speakerId: args.speakerId,
      side: args.side,
      text: args.text.trim(),
      createdAtMs: args.createdAtMs,
    });
  },
);

export const recordClaim = spacetimedb.reducer(
  {
    id: t.string(),
    roomId: t.string(),
    roundId: t.string(),
    speakerId: t.string(),
    side: t.string(),
    claim: t.string(),
    originalText: t.string(),
    createdAtMs: t.i64(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    const text = args.claim.trim();
    if (!text || ctx.db.claim.id.find(args.id)) return;
    ctx.db.claim.insert({
      id: args.id,
      roomId: args.roomId,
      roundId: args.roundId,
      speakerId: args.speakerId,
      side: args.side,
      claim: text,
      originalText: args.originalText.trim() || text,
      createdAtMs: args.createdAtMs,
    });
  },
);

/** Mirror of the server's claim buffer. Upsert: refinements and evictions update the same row. */
export const recordClaimIdea = spacetimedb.reducer(
  {
    claimId: t.string(),
    roomId: t.string(),
    roundId: t.string(),
    speakerId: t.string(),
    text: t.string(),
    relevance: t.f64(),
    admittedAtMs: t.i64(),
    updatedAtMs: t.i64(),
    evictedAtMs: t.i64(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    const text = args.text.trim();
    if (!text) return;
    const row = { ...args, text };
    if (ctx.db.claimIdea.claimId.find(args.claimId)) ctx.db.claimIdea.claimId.update(row);
    else ctx.db.claimIdea.insert(row);
  },
);

export const recordFactCheck = spacetimedb.reducer(
  {
    id: t.string(),
    roomId: t.string(),
    roundId: t.string(),
    challengerId: t.string(),
    challengingSide: t.string(),
    speakerId: t.string(),
    speakerSide: t.string(),
    claimId: t.string(),
    claimText: t.string(),
    status: t.string(),
    finalVerdict: t.string(),
    challengeOutcome: t.string(),
    scoreDelta: t.i32(),
    scoreA: t.i32(),
    scoreB: t.i32(),
    createdAtMs: t.i64(),
    resolvedAtMs: t.i64(),
    geminiVerdict: t.string(),
    geminiConfidence: t.f64(),
    claudeVerdict: t.string(),
    claudeConfidence: t.f64(),
  },
  (ctx, args) => {
    assertOwner(ctx);
    if (!ctx.db.room.roomId.find(args.roomId)) throw new SenderError('room not found');
    const existing = ctx.db.factCheck.id.find(args.id);
    const row = {
      id: args.id,
      roomId: args.roomId,
      roundId: args.roundId,
      challengerId: args.challengerId,
      challengingSide: args.challengingSide,
      speakerId: args.speakerId,
      speakerSide: args.speakerSide,
      claimId: args.claimId,
      claimText: args.claimText,
      status: args.status,
      finalVerdict: args.finalVerdict,
      challengeOutcome: args.challengeOutcome,
      scoreDelta: args.scoreDelta,
      speakerRotated: false,
      nextSpeakerId: '',
      createdAtMs: args.createdAtMs,
      resolvedAtMs: args.resolvedAtMs,
    };
    if (!existing) ctx.db.factCheck.insert(row);
    else ctx.db.factCheck.id.update(row);
    const usageKey = `${args.roundId}:${args.challengerId}`;
    if (!ctx.db.factCheckUsage.usageKey.find(usageKey)) {
      ctx.db.factCheckUsage.insert({
        id: 0n,
        usageKey,
        roundId: args.roundId,
        participantId: args.challengerId,
        factCheckId: args.id,
        usedAtMs: args.createdAtMs,
      });
    }
    for (const vote of [
      { provider: 'GEMINI', verdict: args.geminiVerdict, confidence: args.geminiConfidence },
      { provider: 'CLAUDE', verdict: args.claudeVerdict, confidence: args.claudeConfidence },
    ]) {
      if (vote.verdict !== 'CORRECT' && vote.verdict !== 'INCORRECT') continue;
      const voteKey = `${args.id}:${vote.provider}`;
      if (ctx.db.factCheckVote.voteKey.find(voteKey)) continue;
      ctx.db.factCheckVote.insert({
        id: 0n,
        voteKey,
        factCheckId: args.id,
        provider: vote.provider,
        verdict: vote.verdict,
        confidence: vote.confidence,
      });
    }
    ensureGame(ctx, args.roomId, 0);
    const state = ctx.db.gameState.roomId.find(args.roomId)!;
    ctx.db.gameState.roomId.update({
      ...state,
      roundId: args.roundId,
      scoreA: args.scoreA,
      scoreB: args.scoreB,
      phase: args.status === 'RESOLVED' ? 'VERDICT' : 'FACT_CHECKING',
      activeFactCheckId: args.status === 'RESOLVED' ? '' : args.id,
    });
    if (args.status === 'RESOLVED' && (!existing || existing.status !== 'RESOLVED')) {
      event(
        ctx,
        args.roomId,
        args.roundId,
        args.challengeOutcome === 'SUCCESSFUL'
          ? 'FACT_CHECK_SUCCESSFUL'
          : args.challengeOutcome === 'FAILED'
            ? 'FACT_CHECK_FAILED'
            : 'FACT_CHECK_NO_DECISION',
        args.challengerId,
        args.challengingSide,
        args.scoreDelta,
      );
    }
  },
);
