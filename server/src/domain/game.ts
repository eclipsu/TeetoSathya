import { winnerByScore, type RoundEnd, type RoundWinner, type TeamIndex, type ToastType } from '@teeto/shared';
import type { Buzz, Participant, Room } from './model';
import { speakersOnTeam } from './seats';

/**
 * Game rules: pure functions over Room with an injected `now`, so they're unit-testable.
 *
 * Clock model (chess clock with per-speaker budgets):
 * - Every speaker has a talk-time budget of settings.turnSeconds for the round.
 * - clocks[side] = remaining budget of that side's CURRENT hot-seat speaker, as of
 *   clockRunningSince. Only the active side's clock runs.
 * - "Done speaking" / "Switch turn" hands the floor over; remaining time carries over.
 * - When a speaker hits 0, their next teammate with time takes their team's hot seat,
 *   and the floor switches to the other side.
 * - Pause and buzz freeze both clocks AND the round clock.
 */

export interface GameToast {
  type: ToastType;
  message: string;
}
export type GameResult = { ok: true; toasts: GameToast[] } | { ok: false; message: string };

const ok = (...toasts: GameToast[]): GameResult => ({ ok: true, toasts });
const fail = (message: string): GameResult => ({ ok: false, message });
export const other = (s: TeamIndex): TeamIndex => (s === 0 ? 1 : 0);

export const budgetMs = (room: Room) => room.settings.turnSeconds * 1000;
export const remainingBudget = (room: Room, p: Participant) => Math.max(0, budgetMs(room) - p.timeUsedMs);

function hotP(room: Room, side: TeamIndex): Participant | null {
  const id = room.game.hotSeat[side];
  return id ? room.participants.get(id) ?? null : null;
}

/** Bring clocks up to `now`: charge elapsed time to the active hot-seat speaker. */
export function settle(room: Room, now: number): void {
  const g = room.game;
  if (g.clockRunningSince === null || g.activeSide === null) return;
  const side = g.activeSide;
  const elapsed = Math.max(0, now - g.clockRunningSince);
  const charged = Math.min(elapsed, g.clocks[side]);
  g.clocks[side] = Math.max(0, g.clocks[side] - elapsed);
  const p = hotP(room, side);
  if (p) p.timeUsedMs = Math.min(budgetMs(room), p.timeUsedMs + charged);
  g.clockRunningSince = now;
}

/** Live remaining ms on a side's clock (for tests / server-side checks). */
export function clockRemaining(room: Room, side: TeamIndex, now: number): number {
  const g = room.game;
  if (g.activeSide === side && g.clockRunningSince !== null) return Math.max(0, g.clocks[side] - (now - g.clockRunningSince));
  return g.clocks[side];
}

/**
 * Next speaker on a team after `afterSessionId` (by seat order, wrapping) who still has time.
 * Prefers connected players; falls back to ones inside their reconnect grace period.
 */
export function nextSpeaker(room: Room, side: TeamIndex, afterSessionId: string | null, includeCurrent = false): Participant | null {
  const list = speakersOnTeam(room, side);
  if (!list.length) return null;
  const start = afterSessionId ? list.findIndex((p) => p.sessionId === afterSessionId) : -1;
  const ordered: Participant[] = [];
  for (let i = 1; i <= list.length; i++) ordered.push(list[(start + i + list.length) % list.length]!);
  const eligible = ordered.filter((p) => (includeCurrent || p.sessionId !== afterSessionId) && remainingBudget(room, p) > 0 && !room.game.eliminated.has(p.sessionId));
  return eligible.find((p) => p.connected) ?? eligible[0] ?? null;
}

/** Put `p` (or nobody) in a side's hot seat; their clock shows their remaining budget. */
function seat(room: Room, side: TeamIndex, p: Participant | null, now: number): void {
  const g = room.game;
  g.hotSeat[side] = p?.sessionId ?? null;
  g.clocks[side] = p ? remainingBudget(room, p) : 0;
  if (g.activeSide === side && g.clockRunningSince !== null) g.clockRunningSince = now;
}

function anyoneHasTime(room: Room): boolean {
  for (const p of room.participants.values()) if (p.role === 'speaker' && p.team !== null && remainingBudget(room, p) > 0 && !room.game.eliminated.has(p.sessionId)) return true;
  return false;
}

function freeze(room: Room, now: number): void {
  const g = room.game;
  settle(room, now);
  g.paused = true;
  g.clockRunningSince = null;
  if (g.roundEndsAt !== null) g.roundRemainingMs = Math.max(0, g.roundEndsAt - now);
  g.roundEndsAt = null;
}

function unfreeze(room: Room, now: number): void {
  const g = room.game;
  g.paused = false;
  g.roundEndsAt = now + (g.roundRemainingMs ?? room.settings.roundSeconds * 1000);
  g.roundRemainingMs = null;
  g.clockRunningSince = now;
}

/** Same clock freeze pause/buzz use. Fact-check holds the floor with this, without switching turns. */
export function freezeClocks(room: Room, now: number): void {
  freeze(room, now);
}
export function unfreezeClocks(room: Room, now: number): void {
  unfreeze(room, now);
}

// ---------------------------------------------------------------- transitions

/** Why the round can't start yet, or null. */
export function startBlockReason(room: Room): string | null {
  if (room.status !== 'lobby') return 'The round has already started.';
  for (const side of [0, 1] as const) {
    if (!speakersOnTeam(room, side).length) return `${room.sides[side]} needs at least one speaker.`;
  }
  return null;
}

/** Short break between rounds; the next round's announcement is prepared during it. */
export const INTERMISSION_MS = 5_000;
/** If the announcement isn't ready by then, the game timer starts the next round without it. */
export const INTERMISSION_GRACE_MS = 9_000;

/**
 * A random speaker on `side` who hasn't opened a round yet this game (connected ones first).
 * Falls back to anyone on the side once everyone has opened.
 */
export function pickOpener(room: Room, side: TeamIndex, rand: () => number = Math.random): Participant | null {
  const team = speakersOnTeam(room, side);
  const fresh = team.filter((p) => !room.game.openedBy.has(p.sessionId));
  const pool = fresh.length ? fresh : team;
  const connected = pool.filter((p) => p.connected);
  const from = connected.length ? connected : pool;
  return from.length ? from[Math.floor(rand() * from.length)]! : null;
}

/** Who opens round 1: the host's pick in side A's hot seat, else side A's first seat (what the lobby previews). */
export function openingSpeaker(room: Room): Participant | null {
  const cur = hotP(room, 0);
  return cur && cur.role === 'speaker' && cur.team === 0 ? cur : nextSpeaker(room, 0, null, true);
}

/** Side that opens round n: A, B, A, B… */
export const openingSideFor = (roundNumber: number): TeamIndex => (roundNumber % 2 === 1 ? 0 : 1);

/** Reset per-round state and give `opener` the floor. Scores, fact-check history and the round log carry over. */
function beginRound(room: Room, now: number, roundNumber: number, opener: Participant): void {
  const g = room.game;
  const openingSide = opener.team as TeamIndex;
  for (const p of room.participants.values()) p.timeUsedMs = 0;
  g.roundSeq += 1;
  g.roundNumber = roundNumber;
  g.factCheckUsed = new Set();
  g.considering = new Set();
  g.eliminated = new Set();
  g.factCheckResumeAt = null;
  g.intro = null;
  g.intermission = null;
  g.activeFactCheckId = null;
  g.buzz = null;
  g.roundOpener = opener.sessionId;
  g.roundClaim = null;
  g.openedBy.add(opener.sessionId);
  g.activeSide = null;
  g.clockRunningSince = null;
  seat(room, openingSide, opener, now);
  const otherSide = other(openingSide);
  const cur = hotP(room, otherSide);
  const valid = cur && cur.role === 'speaker' && cur.team === otherSide;
  seat(room, otherSide, valid ? cur : nextSpeaker(room, otherSide, null, true), now);
  room.status = 'live';
  g.activeSide = openingSide;
  g.paused = false;
  g.clockRunningSince = now;
  g.roundEndsAt = now + room.settings.roundSeconds * 1000;
  g.roundRemainingMs = null;
}

/** Start the game: round 1, opened by side A. `openerSessionId` keeps the announcement and the start in agreement. */
export function startRound(room: Room, now: number, openerSessionId?: string): GameResult {
  const blocked = startBlockReason(room);
  if (blocked) return fail(blocked);
  const g = room.game;
  g.winner = null;
  g.scores = [0, 0];
  g.segments = [];
  g.claims = [];
  g.factChecks = [];
  g.openedBy = new Set();
  g.roundLog = [];
  const chosen = openerSessionId ? room.participants.get(openerSessionId) : undefined;
  const opener = chosen && chosen.role === 'speaker' && chosen.team === 0 ? chosen : openingSpeaker(room);
  if (!opener) return fail(`${room.sides[0]} needs at least one speaker.`);
  beginRound(room, now, 1, opener);
  const total = room.settings.totalRounds;
  return ok({ type: 'success', message: `Round 1${total > 1 ? ` of ${total}` : ''}: ${opener.username} opens for ${room.sides[0]}.` });
}

/**
 * The current round is over. Before the last round: freeze everything and schedule the next one,
 * with its opener already chosen (the other side opens). After the last round: the game ends.
 */
export function finishRound(room: Room, now: number, endedBy: RoundEnd, outTeam: TeamIndex | null = null): GameResult {
  if (room.status !== 'live') return fail('The round is not live.');
  const g = room.game;
  if (g.intermission) return fail('The round is already over.');
  settle(room, now);
  settleOpenFactCheck(room);
  logRound(room, endedBy, outTeam);
  const why = endedBy === 'out' && outTeam !== null ? `${room.sides[outTeam]} ran out of speakers` : endedBy === 'time' ? 'time is up' : 'the host ended it';
  if (g.roundNumber >= room.settings.totalRounds) {
    const res = endRound(room, now);
    return res.ok ? ok({ type: 'info', message: `Round ${g.roundNumber} over: ${why}.` }, ...res.toasts) : res;
  }
  freeze(room, now);
  g.buzz = null;
  g.factCheckResumeAt = null;
  g.intro = null;
  g.considering.clear();
  const nextRound = g.roundNumber + 1;
  const openingSide = openingSideFor(nextRound);
  const next = pickOpener(room, openingSide);
  g.intermission = { until: now + INTERMISSION_MS, nextRound, openingSide, openerSessionId: next?.sessionId ?? null, endedBy, outTeam };
  return ok({ type: 'info', message: `Round ${g.roundNumber} over: ${why}. Round ${nextRound}: ${next ? `${next.username} opens for ` : ''}${room.sides[openingSide]}.` });
}

/** End of the break: the chosen opener takes the floor. */
export function startNextRound(room: Room, now: number): GameResult {
  const g = room.game;
  const im = g.intermission;
  if (room.status !== 'live' || !im) return fail('No round is waiting to start.');
  const chosen = im.openerSessionId ? room.participants.get(im.openerSessionId) : undefined;
  const opener = chosen && chosen.role === 'speaker' && chosen.team === im.openingSide ? chosen : pickOpener(room, im.openingSide);
  if (!opener) {
    g.intermission = null;
    return endRound(room, now);
  }
  beginRound(room, now, im.nextRound, opener);
  return ok({ type: 'success', message: `Round ${im.nextRound}: ${opener.username} opens for ${room.sides[im.openingSide]}.` });
}

/** Record the current round in the log once (finishRound, or the host ending the game mid-round). */
function logRound(room: Room, endedBy: RoundEnd, outTeam: TeamIndex | null): void {
  const g = room.game;
  if (g.roundNumber === 0 || g.roundLog.at(-1)?.number === g.roundNumber) return;
  const opener = g.roundOpener ? room.participants.get(g.roundOpener) : undefined;
  g.roundLog.push({
    number: g.roundNumber,
    openingSide: (opener?.team ?? openingSideFor(g.roundNumber)) as TeamIndex,
    openerName: opener?.username ?? null,
    claim: g.roundClaim?.text ?? null,
    endedBy,
    outTeam,
  });
}

/** A check still running when the round ends can't finish: no decision, no points. */
function settleOpenFactCheck(room: Room): void {
  const g = room.game;
  const active = g.factChecks.find((f) => f.id === g.activeFactCheckId);
  if (active && active.status === 'checking') {
    active.status = 'resolved';
    active.verdict = 'INCONCLUSIVE';
    active.outcome = 'no_decision';
    active.scoreDelta = 0;
    active.unavailable = true;
    active.explanation = 'Fact check unavailable.';
    active.confidence = null;
    active.juryPhase = null;
    active.thinking = [];
  }
  g.activeFactCheckId = null;
}

/**
 * After a fact-check verdict clears: a speaker the challenge knocked out leaves the hot seat and
 * the next teammate takes over. A team with nobody left is out, and the round ends.
 */
export function replaceEliminated(room: Room, now: number): { toasts: GameToast[]; roundOver: boolean } {
  const g = room.game;
  const toasts: GameToast[] = [];
  for (const side of [0, 1] as const) {
    const sid = g.hotSeat[side];
    if (!sid || !g.eliminated.has(sid)) continue;
    const out = room.participants.get(sid);
    const repl = nextSpeaker(room, side, sid);
    if (!repl) {
      seat(room, side, null, now);
      const res = finishRound(room, now, 'out', side);
      if (res.ok) toasts.push(...res.toasts);
      return { toasts, roundOver: true };
    }
    seat(room, side, repl, now);
    toasts.push({ type: 'warn', message: `${out?.username ?? 'The speaker'} is out. ${repl.username} takes over for ${room.sides[side]}.` });
  }
  return { toasts, roundOver: false };
}

/** Right after startRound: hold every clock while the host's announcement plays. */
export function beginIntro(room: Room, now: number, text: string, ms: number): void {
  if (room.status !== 'live' || ms <= 0) return;
  freeze(room, now);
  room.game.intro = { text, until: now + ms };
}

export function setHotSeat(room: Room, side: TeamIndex, sessionId: string, now: number): GameResult {
  if (room.status === 'ended') return fail('The round is over.');
  if (room.game.activeFactCheckId) return fail('Dismiss the fact check first.');
  if (side !== 0 && side !== 1) return fail('Unknown side.');
  const p = room.participants.get(sessionId);
  if (!p || p.role !== 'speaker' || p.team !== side) return fail(`That player isn't a speaker for ${room.sides[side] ?? 'that side'}.`);
  if (room.game.intermission) return fail('The next round is about to start.');
  if (room.game.eliminated.has(sessionId)) return fail(`${p.username} is out for this round.`);
  if (room.game.hotSeat[side] === sessionId) return ok();
  if (room.status === 'live' && remainingBudget(room, p) <= 0) return fail(`${p.username} has no time left.`);
  settle(room, now);
  seat(room, side, p, now);
  return ok({ type: 'info', message: `${p.username} is in the hot seat for ${room.sides[side]}.` });
}

/** Hand the floor to the other side. Used by "done speaking", host switch, clock expiry and buzz. */
function switchTurn(room: Room, now: number): GameToast[] {
  const g = room.game;
  if (g.activeSide === null) return [];
  settle(room, now);
  const from = g.activeSide;
  const to = other(from);
  let incoming = hotP(room, to);
  if (!incoming || remainingBudget(room, incoming) <= 0) {
    incoming = nextSpeaker(room, to, incoming?.sessionId ?? null, !incoming);
    seat(room, to, incoming, now);
  }
  if (!incoming) {
    const current = hotP(room, from);
    if (current && remainingBudget(room, current) > 0) {
      return [{ type: 'warn', message: `Nobody on ${room.sides[to]} has time left. ${room.sides[from]} keeps the floor.` }];
    }
    const res = finishRound(room, now, 'time');
    return res.ok ? res.toasts : [];
  }
  g.activeSide = to;
  if (g.clockRunningSince !== null) g.clockRunningSince = now;
  return [];
}

/** The active hot-seat speaker presses SPACE: "I'm done". */
export function turnDone(room: Room, sessionId: string, now: number): GameResult {
  const g = room.game;
  if (room.status !== 'live') return fail('The round is not live.');
  if (g.activeFactCheckId) return fail('A fact check is in progress.');
  if (g.buzz) return fail('A buzz is in progress.');
  if (g.paused) return fail('The round is paused.');
  if (g.activeSide === null || g.hotSeat[g.activeSide] !== sessionId) return fail("It's not your turn.");
  const name = hotP(room, g.activeSide)?.username;
  const toasts = switchTurn(room, now);
  const next = g.activeSide !== null ? hotP(room, g.activeSide) : null;
  if (room.status === 'live' && next && next.sessionId !== sessionId) toasts.unshift({ type: 'info', message: `${name} is done. ${next.username}, your turn.` });
  return ok(...toasts);
}

export function hostSwitchTurn(room: Room, now: number): GameResult {
  if (room.status !== 'live') return fail('The round is not live.');
  if (room.game.activeFactCheckId) return fail('Dismiss the fact check first.');
  if (room.game.buzz) return fail('Dismiss the buzz first.');
  return ok(...switchTurn(room, now));
}

export function rotateSpeaker(room: Room, side: TeamIndex, now: number): GameResult {
  if (room.status === 'ended') return fail('The round is over.');
  if (room.game.activeFactCheckId) return fail('Dismiss the fact check first.');
  if (side !== 0 && side !== 1) return fail('Unknown side.');
  const cur = hotP(room, side);
  const next = nextSpeaker(room, side, cur?.sessionId ?? null);
  if (!next) return fail(`No other ${room.sides[side]} speaker with time left.`);
  settle(room, now);
  seat(room, side, next, now);
  return ok({ type: 'info', message: `${next.username} replaces ${cur?.username ?? 'the empty seat'} for ${room.sides[side]}.` });
}

export function pause(room: Room, now: number): GameResult {
  if (room.status !== 'live') return fail('The round is not live.');
  if (room.game.paused) return ok();
  freeze(room, now);
  return ok({ type: 'info', message: 'Paused by the host.' });
}

export function resume(room: Room, now: number): GameResult {
  if (room.status !== 'live') return fail('The round is not live.');
  if (room.game.activeFactCheckId) return fail('Dismiss the fact check to resume.');
  if (room.game.buzz) return fail('Dismiss the buzz to resume.');
  if (room.game.intermission) return fail('The next round is about to start.');
  room.game.intro = null; // host skipped the announcement
  if (!room.game.paused) return ok();
  unfreeze(room, now);
  return ok({ type: 'info', message: 'Resumed.' });
}

/** End the whole game: summary, winner by total points (host breaks a tie). */
export function endRound(room: Room, now: number): GameResult {
  if (room.status !== 'live') return fail('The round is not live.');
  const g = room.game;
  settle(room, now);
  settleOpenFactCheck(room);
  if (!g.intermission) logRound(room, 'host', null); // ended mid-round
  g.considering.clear();
  g.factCheckResumeAt = null;
  g.intro = null;
  g.intermission = null;
  room.status = 'ended';
  g.roundRemainingMs = g.roundEndsAt !== null ? Math.max(0, g.roundEndsAt - now) : g.roundRemainingMs;
  g.roundEndsAt = null;
  g.clockRunningSince = null;
  g.paused = false;
  g.buzz = null;
  g.activeSide = null;
  const score = g.scores;
  g.winner = winnerByScore(score);
  if (g.winner === null) return ok({ type: 'info', message: `Game over. Tied ${score[0]}–${score[1]}: the host picks the winner.` });
  return ok({ type: 'success', message: `Game over. ${room.sides[g.winner]} wins ${score[g.winner]}–${score[other(g.winner)]}.` });
}

/** Host breaks a tie after the round. A decided winner can't be changed. */
export function pickWinner(room: Room, winner: RoundWinner): GameResult {
  if (room.status !== 'ended') return fail('The round has not ended yet.');
  if (room.game.winner !== null) return fail('The winner is already decided.');
  if (winnerByScore(room.game.scores) !== null) return fail('The score already decides the winner.');
  room.game.winner = winner;
  return ok({ type: 'success', message: winner === 'draw' ? 'The host called it a draw.' : `The host picked ${room.sides[winner]} as the winner.` });
}

export function updateSettings(room: Room, turnSeconds: number, roundSeconds: number, totalRounds = room.settings.totalRounds): GameResult {
  if (room.status !== 'lobby') return fail('Clock lengths can only be changed in the lobby.');
  room.settings.turnSeconds = turnSeconds;
  room.settings.roundSeconds = roundSeconds;
  room.settings.totalRounds = totalRounds;
  room.game.clocks = [turnSeconds * 1000, turnSeconds * 1000];
  return ok({ type: 'info', message: `${totalRounds} round${totalRounds === 1 ? '' : 's'} of ${Math.round(roundSeconds / 60)} min, ${turnSeconds}s per speaker.` });
}

/** When the next server-side timer must fire (fact-check resume, clock, or round expiry). */
export function nextDeadline(room: Room): number | null {
  const g = room.game;
  if (room.status !== 'live') return null;
  if (g.intermission) return g.intermission.until + INTERMISSION_GRACE_MS;
  if (g.factCheckResumeAt !== null) return g.factCheckResumeAt;
  if (g.intro) return g.intro.until;
  if (g.clockRunningSince === null || g.activeSide === null) return null;
  const clockEnd = g.clockRunningSince + g.clocks[g.activeSide];
  return g.roundEndsAt !== null ? Math.min(clockEnd, g.roundEndsAt) : clockEnd;
}

/** Called by the timer engine at (or after) nextDeadline. Idempotent if nothing expired. */
export function tick(room: Room, now: number): GameResult {
  const g = room.game;
  if (room.status !== 'live') return ok();
  if (g.intermission) {
    // Normally the round flow starts the next round once its announcement is ready; this is the fallback.
    if (now < g.intermission.until + INTERMISSION_GRACE_MS) return ok();
    return startNextRound(room, now);
  }
  if (g.factCheckResumeAt !== null && now >= g.factCheckResumeAt) {
    g.factCheckResumeAt = null;
    const challenge = g.factChecks.find((f) => f.id === g.activeFactCheckId);
    if (!challenge || challenge.status === 'checking') return ok();
    g.activeFactCheckId = null;
    const out = replaceEliminated(room, now);
    if (out.roundOver) return ok(...out.toasts);
    if (g.paused && !g.buzz) unfreeze(room, now);
    return ok(...out.toasts, { type: 'info', message: 'Fact check over. Clock running.' });
  }
  if (g.intro) {
    if (now < g.intro.until) return ok();
    g.intro = null;
    if (g.paused && !g.buzz && !g.activeFactCheckId) unfreeze(room, now);
    const opener = g.activeSide !== null ? hotP(room, g.activeSide) : null;
    return ok({ type: 'info', message: opener ? `${opener.username}, the floor is yours.` : 'The floor is open.' });
  }
  if (g.clockRunningSince === null || g.activeSide === null) return ok();
  if (g.roundEndsAt !== null && now >= g.roundEndsAt) return finishRound(room, g.roundEndsAt, 'time');
  const side = g.activeSide;
  if (now < g.clockRunningSince + g.clocks[side]) return ok();

  settle(room, now);
  const out = hotP(room, side);
  const toasts: GameToast[] = [{ type: 'warn', message: `${out?.username ?? 'Speaker'} is out of time.` }];
  if (!anyoneHasTime(room)) {
    const res = finishRound(room, now, 'time');
    if (res.ok) toasts.push(...res.toasts);
    return ok(...toasts);
  }
  // Exhausted speaker is replaced for their team's next turn (if a teammate has time).
  const repl = nextSpeaker(room, side, out?.sessionId ?? null);
  if (repl) {
    seat(room, side, repl, now);
    toasts.push({ type: 'info', message: `${repl.username} takes over for ${room.sides[side]}.` });
  }
  toasts.push(...switchTurn(room, now));
  return ok(...toasts);
}

/**
 * A hot seat was emptied (player left, switched team/role, or timed out of grace).
 * Fill it with the next teammate who has time; if the empty side held the floor, hand it over.
 */
export function hotSeatVacated(room: Room, side: TeamIndex, now: number): GameToast[] {
  if (room.status !== 'live') return [];
  const g = room.game;
  // The departed speaker's uncharged seconds are dropped rather than billed to the replacement.
  if (g.activeSide === side && g.clockRunningSince !== null) g.clockRunningSince = now;
  const repl = nextSpeaker(room, side, null, true);
  seat(room, side, repl, now);
  if (repl) return [{ type: 'info', message: `${repl.username} moves into the hot seat for ${room.sides[side]}.` }];
  if (g.activeSide === side) return switchTurn(room, now);
  return [];
}

/** While live, a team that gained its first speaker gets them in the hot seat. */
export function fillEmptyHotSeats(room: Room, now: number): void {
  if (room.status !== 'live') return;
  for (const side of [0, 1] as const) {
    if (room.game.hotSeat[side] === null) seat(room, side, nextSpeaker(room, side, null, true), now);
  }
}

// ---------------------------------------------------------------- buzzer

/** Why this participant can't buzz right now, or null if they can. */
export function buzzBlockReason(room: Room, sessionId: string): string | null {
  const p = room.participants.get(sessionId);
  const g = room.game;
  if (!p) return 'Join the room first.';
  if (p.role !== 'spectator') return 'Only spectators can buzz in.';
  if (room.status !== 'live') return 'The round is not live.';
  if (g.activeFactCheckId) return 'A fact check is in progress.';
  if (g.buzz) return 'Someone already buzzed.';
  if (g.paused) return 'The round is paused.';
  return null;
}

export type BuzzResult = { ok: true; buzz: Buzz; toasts: GameToast[] } | { ok: false; tooLate: boolean; message: string };

/**
 * First valid press wins (the caller processes presses in arrival order on one thread).
 * Locks the buzzer, freezes both clocks, and hands the floor to the other side.
 */
export function pressBuzz(room: Room, sessionId: string, now: number): BuzzResult {
  const reason = buzzBlockReason(room, sessionId);
  if (reason) return { ok: false, tooLate: room.game.buzz !== null, message: reason };
  const p = room.participants.get(sessionId)!;
  const challenged = room.game.activeSide !== null ? hotP(room, room.game.activeSide) : null;
  const buzz: Buzz = { sessionId, username: p.username, at: now, challengedSessionId: challenged?.sessionId ?? null };
  freeze(room, now);
  room.game.buzz = buzz;
  const toasts = switchTurn(room, now);
  toasts.unshift({ type: 'warn', message: `${p.username} buzzed in on ${challenged?.username ?? 'the speaker'}!` });
  return { ok: true, buzz, toasts };
}

/** Host clears the buzz: floor stays with the side it switched to; clocks resume. */
export function dismissBuzz(room: Room, now: number): { ok: true; buzz: Buzz; toasts: GameToast[] } | { ok: false; message: string } {
  const g = room.game;
  if (room.status !== 'live' || !g.buzz) return { ok: false, message: 'There is no buzz to dismiss.' };
  const buzz = g.buzz;
  g.buzz = null;
  unfreeze(room, now);
  return { ok: true, buzz, toasts: [{ type: 'info', message: 'Buzz dismissed. Clock running.' }] };
}
