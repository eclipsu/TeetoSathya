import { factCheckBlockReason, type FactCheckOutcome, type FactVerdict, type JuryMessage, type JuryModel, type JuryPhase, type JuryResult, type TeamIndex } from '@teeto/shared';
import type { ExtractedClaim, FactCheckChallenge, Participant, Room, TranscriptSegment } from './model';
import { canPublish } from './micPolicy';
import { freezeClocks, replaceEliminated, unfreezeClocks, type GameToast } from './game';

const CLAIM_CAP = 200;

export function claimKey(text: string): string {
  return text.toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().replace(/[.?!]+$/g, '');
}

/** Hot-seat speaker who currently holds the floor, or null when nobody does. */
export function activeSpeaker(room: Room): Participant | null {
  const side = room.game.activeSide;
  if (side === null) return null;
  const id = room.game.hotSeat[side];
  if (!id) return null;
  const p = room.participants.get(id);
  return p ?? null;
}

/**
 * Server authorization for opening or submitting a fact-check.
 * Does not consume the participant's one attempt.
 */
export function canFactCheck(room: Room, sessionId: string): { ok: true } | { ok: false; reason: string } {
  const p = room.participants.get(sessionId);
  if (!p) return { ok: false, reason: 'Join the room first.' };
  const side = room.game.activeSide;
  const reason = factCheckBlockReason({
    status: room.status,
    role: p.role,
    team: p.team,
    activeSide: side,
    publishing: canPublish(room, p),
    paused: room.game.paused,
    buzzOpen: room.game.buzz !== null,
    factCheckOpen: room.game.activeFactCheckId !== null,
    alreadyUsed: room.game.factCheckUsed.has(sessionId),
    speakerPresent: side !== null && !!room.game.hotSeat[side],
  });
  return reason ? { ok: false, reason } : { ok: true };
}

/**
 * The speaker's buffered ideas, newest first. Normally at most CLAIM_BUFFER_SIZE; while pinned it can
 * briefly hold more, and all of them are offered so nothing disappears from an open picker.
 */
export function getRecentClaims(room: Room, speakerSessionId: string, limit = Infinity): ExtractedClaim[] {
  const live = room.game.claims.filter((c) => c.roomId === room.id && c.speakerSessionId === speakerSessionId && c.roundSeq === room.game.roundSeq && c.evictedAt === null);
  return live.slice(-limit).reverse();
}

export function appendTranscript(room: Room, seg: TranscriptSegment): boolean {
  if (room.status !== 'live' || seg.roundSeq !== room.game.roundSeq) return false;
  if (!room.participants.has(seg.speakerSessionId)) return false;
  const text = seg.text.trim();
  if (!text) return false;
  room.game.segments.push({ ...seg, text });
  if (room.game.segments.length > 400) room.game.segments.splice(0, room.game.segments.length - 400);
  return true;
}

/** Live ideas kept per speaker per round. The picker offers exactly these. */
export const CLAIM_BUFFER_SIZE = 5;
/** Extractor relevance below this never enters the buffer (vague, off-topic, barely checkable). */
export const MIN_RELEVANCE = 0.35;

export interface IncomingClaim {
  id: string;
  text: string;
  originalText: string;
  speakerSessionId: string;
  team: TeamIndex;
  createdAt: number;
  /** 0–1. Missing means fully relevant (manual and test claims). */
  relevance?: number;
  /** Id of a buffered claim this one restates or sharpens: refine that one instead of adding. */
  sameAs?: string | null;
}

export interface BufferChange {
  added: ExtractedClaim[];
  refined: ExtractedClaim[];
  evicted: ExtractedClaim[];
}

/** This speaker's live ideas this round, oldest first. */
function liveIdeas(room: Room, speakerSessionId: string): ExtractedClaim[] {
  return room.game.claims
    .filter((c) => c.roomId === room.id && c.roundSeq === room.game.roundSeq && c.speakerSessionId === speakerSessionId && c.evictedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** While someone is choosing a claim to challenge, the speaker's buffer holds still: nothing vanishes mid-pick. */
export function bufferPinned(room: Room, speakerSessionId: string): boolean {
  return room.game.considering.size > 0 && activeSpeaker(room)?.sessionId === speakerSessionId;
}

/** Push out the oldest ideas until the speaker is back to CLAIM_BUFFER_SIZE. No-op while pinned. */
export function trimBuffer(room: Room, speakerSessionId: string, now: number): ExtractedClaim[] {
  if (bufferPinned(room, speakerSessionId)) return [];
  const live = liveIdeas(room, speakerSessionId);
  const evicted = live.slice(0, Math.max(0, live.length - CLAIM_BUFFER_SIZE));
  for (const c of evicted) c.evictedAt = now;
  return evicted;
}

/**
 * Admit new ideas into a speaker's buffer.
 * - Below MIN_RELEVANCE: dropped.
 * - `sameAs` a live idea: that idea takes the sharper wording, keeps its id and its age.
 * - Same wording as a live idea: dropped. (An evicted idea said again comes back as new.)
 * - Otherwise added; past CLAIM_BUFFER_SIZE the oldest idea is evicted (kept in history).
 */
export function mergeClaims(room: Room, incoming: IncomingClaim[], now = Date.now()): BufferChange {
  const change: BufferChange = { added: [], refined: [], evicted: [] };
  if (room.status !== 'live') return change;
  const speakers = new Set<string>();
  for (const raw of incoming) {
    const text = raw.text.trim().slice(0, 280);
    const relevance = Math.max(0, Math.min(1, raw.relevance ?? 1));
    if (!text || relevance < MIN_RELEVANCE) continue;
    const originalText = (raw.originalText.trim() || text).slice(0, 500);
    const live = liveIdeas(room, raw.speakerSessionId);
    const target = raw.sameAs ? live.find((c) => c.id === raw.sameAs) : undefined;
    if (target) {
      if (claimKey(target.text) !== claimKey(text)) {
        target.text = text;
        target.originalText = originalText;
        target.updatedAt = now;
        change.refined.push(target);
      }
      target.relevance = Math.max(target.relevance, relevance);
      if (room.game.roundClaim?.claimId === target.id) room.game.roundClaim.text = target.text;
      continue;
    }
    if (live.some((c) => claimKey(c.text) === claimKey(text))) continue;
    const claim: ExtractedClaim = {
      id: raw.id,
      roomId: room.id,
      speakerSessionId: raw.speakerSessionId,
      team: raw.team,
      text,
      originalText,
      createdAt: raw.createdAt,
      roundSeq: room.game.roundSeq,
      relevance,
      updatedAt: null,
      evictedAt: null,
    };
    room.game.claims.push(claim);
    change.added.push(claim);
    // The opener's first idea is what the round is about.
    if (!room.game.roundClaim && claim.speakerSessionId === room.game.roundOpener) room.game.roundClaim = { claimId: claim.id, text: claim.text };
    speakers.add(raw.speakerSessionId);
  }
  for (const sid of speakers) change.evicted.push(...trimBuffer(room, sid, now));
  if (room.game.claims.length > CLAIM_CAP) room.game.claims.splice(0, room.game.claims.length - CLAIM_CAP);
  return change;
}

export type OpenFactCheckResult =
  | { ok: true; challenge: FactCheckChallenge }
  | { ok: false; reason: string };

/**
 * Validate and open a challenge. Consumes the challenger's attempt only after
 * every check passes. Freezes clocks the same way pause/buzz do, and does not
 * switch the floor.
 */
export function openFactCheck(room: Room, challengerSessionId: string, claimId: string, now: number, id: string): OpenFactCheckResult {
  const gate = canFactCheck(room, challengerSessionId);
  if (!gate.ok) return gate;
  const speaker = activeSpeaker(room);
  if (!speaker || speaker.team === null) return { ok: false, reason: 'Nobody is speaking.' };
  const claim = room.game.claims.find((c) => c.id === claimId);
  if (!claim || claim.roomId !== room.id || claim.roundSeq !== room.game.roundSeq) return { ok: false, reason: 'That claim is not from this room.' };
  if (claim.speakerSessionId !== speaker.sessionId) return { ok: false, reason: 'That claim is not from the speaker who has the floor.' };
  const challenger = room.participants.get(challengerSessionId);
  if (!challenger || challenger.team === null) return { ok: false, reason: 'Join the room first.' };

  room.game.factCheckUsed.add(challengerSessionId);
  // The room is about to watch the jury; nobody else can open a check until it clears.
  room.game.considering.clear();
  trimBuffer(room, speaker.sessionId, now);
  freezeClocks(room, now);
  const challenge: FactCheckChallenge = {
    id,
    roundSeq: room.game.roundSeq,
    challengerSessionId,
    challengerId: challenger.id,
    challengerName: challenger.username,
    challengerTeam: challenger.team,
    speakerSessionId: speaker.sessionId,
    speakerId: speaker.id,
    speakerName: speaker.username,
    speakerTeam: speaker.team,
    claimId: claim.id,
    claim: claim.text,
    status: 'checking',
    verdict: null,
    confidence: null,
    explanation: null,
    unavailable: false,
    outcome: null,
    juryPhase: 'independent',
    jury: null,
    thread: [],
    thinking: [],
    createdAt: now,
    scoreDelta: null,
  };
  room.game.factChecks.push(challenge);
  room.game.activeFactCheckId = id;
  return { ok: true, challenge };
}

export interface FactCheckResolution {
  verdict: FactVerdict;
  confidence: number;
  explanation: string;
  unavailable?: boolean;
  jury?: JuryResult | null;
}

/** CORRECT/SUPPORTED means the speaker's claim stood. INCORRECT/CONTRADICTED means the challenge landed. */
export function outcomeForVerdict(verdict: FactVerdict, unavailable = false): FactCheckOutcome {
  if (unavailable) return 'no_decision';
  if (verdict === 'INCORRECT' || verdict === 'CONTRADICTED') return 'successful';
  if (verdict === 'CORRECT' || verdict === 'SUPPORTED') return 'failed';
  return 'no_decision';
}

/** Fill in a check that is still running. Ignores late results after it already resolved. */
export function resolveFactCheck(room: Room, challengeId: string, result: FactCheckResolution): { ok: true; challenge: FactCheckChallenge } | { ok: false; reason: string } {
  const challenge = room.game.factChecks.find((f) => f.id === challengeId);
  if (!challenge) return { ok: false, reason: 'That fact check no longer exists.' };
  if (challenge.status !== 'checking') return { ok: false, reason: 'That fact check already finished.' };
  if (challenge.roundSeq !== room.game.roundSeq && room.status === 'live') return { ok: false, reason: 'That fact check was from another round.' };
  challenge.status = 'resolved';
  challenge.verdict = result.verdict;
  challenge.confidence = result.confidence;
  challenge.explanation = result.explanation;
  challenge.unavailable = !!result.unavailable;
  challenge.jury = result.jury ?? null;
  challenge.juryPhase = null;
  challenge.thinking = [];
  challenge.outcome = outcomeForVerdict(result.verdict, !!result.unavailable);
  const delta = challenge.outcome === 'successful' ? 100 : challenge.outcome === 'failed' ? -50 : 0;
  challenge.scoreDelta = delta;
  room.game.scores[challenge.challengerTeam] += delta;
  // Caught out: the speaker leaves the hot seat once the verdict clears (see replaceEliminated).
  if (challenge.outcome === 'successful') room.game.eliminated.add(challenge.speakerSessionId);
  room.game.factCheckResumeAt = null;
  return { ok: true, challenge };
}

/** Verdict is on screen. Clocks stay frozen until this moment, then resume on their own. */
export const FACT_CHECK_RESUME_MS = 3_500;
export function beginFactCheckCountdown(room: Room, now: number): void {
  const challenge = room.game.factChecks.find((f) => f.id === room.game.activeFactCheckId);
  if (!challenge || challenge.status !== 'resolved') return;
  room.game.factCheckResumeAt = now + FACT_CHECK_RESUME_MS;
}

/** Progress only. Does not resolve the check or touch the clocks. */
export function setJuryPhase(room: Room, challengeId: string, phase: JuryPhase): boolean {
  const challenge = room.game.factChecks.find((f) => f.id === challengeId);
  if (!challenge || challenge.status !== 'checking') return false;
  challenge.juryPhase = phase;
  return true;
}

/** Live conversation: which jurors are writing right now. */
export function setJuryThinking(room: Room, challengeId: string, models: JuryModel[]): boolean {
  const challenge = room.game.factChecks.find((f) => f.id === challengeId);
  if (!challenge || challenge.status !== 'checking') return false;
  challenge.thinking = [...models];
  return true;
}

/** Live conversation: append one juror message and mark that juror as done writing. */
export function addJuryMessage(room: Room, challengeId: string, message: JuryMessage): boolean {
  const challenge = room.game.factChecks.find((f) => f.id === challengeId);
  if (!challenge || challenge.status !== 'checking') return false;
  challenge.thread.push(message);
  challenge.thinking = challenge.thinking.filter((m) => m !== message.model);
  return true;
}

/** Challenger opened or closed the claim picker. Only a label for the room; refused once they can't check. */
export function setConsidering(room: Room, sessionId: string, on: boolean): boolean {
  const had = room.game.considering.has(sessionId);
  if (!on) {
    room.game.considering.delete(sessionId);
    // Picker closed: the buffer catches up on any evictions it held back.
    const speaker = activeSpeaker(room);
    if (had && speaker) trimBuffer(room, speaker.sessionId, Date.now());
    return had;
  }
  if (had || !canFactCheck(room, sessionId).ok) return false;
  room.game.considering.add(sessionId);
  return true;
}

/** Host resumes early. Refuses while the referee is still working, so the room can read the verdict. */
export function dismissFactCheck(room: Room, now: number): { ok: true; toasts: GameToast[] } | { ok: false; message: string } {
  if (room.status !== 'live' || !room.game.activeFactCheckId) return { ok: false, message: 'There is no fact check to dismiss.' };
  const challenge = room.game.factChecks.find((f) => f.id === room.game.activeFactCheckId);
  if (challenge?.status === 'checking') return { ok: false, message: 'The fact check is still running.' };
  room.game.factCheckResumeAt = null;
  room.game.activeFactCheckId = null;
  const out = replaceEliminated(room, now);
  if (!out.roundOver) unfreezeClocks(room, now);
  return { ok: true, toasts: out.toasts };
}

/** Model said SUPPORTED/CONTRADICTED but was not confident enough: treat as no decision. */
export function coerceVerdict(verdict: string, confidence: number): FactVerdict | null {
  const v = verdict.trim().toUpperCase();
  if (v !== 'SUPPORTED' && v !== 'CONTRADICTED' && v !== 'INCONCLUSIVE') return null;
  if ((v === 'SUPPORTED' || v === 'CONTRADICTED') && !(confidence >= 0.8)) return 'INCONCLUSIVE';
  return v;
}
