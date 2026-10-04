import { factCheckBlockReason, type FactCheckOutcome, type FactVerdict, type JuryMessage, type JuryModel, type JuryPhase, type JuryResult, type TeamIndex } from '@teeto/shared';
import type { ExtractedClaim, FactCheckChallenge, Participant, Room, TranscriptSegment } from './model';
import { canPublish } from './micPolicy';
import { freezeClocks, unfreezeClocks } from './game';

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

/** Newest claims first, at most `limit`, for this speaker in the current round only. */
export function getRecentClaims(room: Room, speakerSessionId: string, limit = 4): ExtractedClaim[] {
  const mine = room.game.claims.filter((c) => c.speakerSessionId === speakerSessionId && c.roundSeq === room.game.roundSeq);
  return mine.slice(-limit).reverse();
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

export interface IncomingClaim {
  id: string;
  text: string;
  originalText: string;
  speakerSessionId: string;
  team: TeamIndex;
  createdAt: number;
}

/** Merge new claims into that speaker's history. Skips blanks and duplicates. */
export function mergeClaims(room: Room, incoming: IncomingClaim[]): ExtractedClaim[] {
  if (room.status !== 'live') return [];
  const added: ExtractedClaim[] = [];
  for (const raw of incoming) {
    const text = raw.text.trim().slice(0, 280);
    if (!text) continue;
    const key = claimKey(text);
    const dup = room.game.claims.some(
      (c) => c.roundSeq === room.game.roundSeq && c.speakerSessionId === raw.speakerSessionId && claimKey(c.text) === key,
    );
    if (dup) continue;
    const claim: ExtractedClaim = {
      id: raw.id,
      roomId: room.id,
      speakerSessionId: raw.speakerSessionId,
      team: raw.team,
      text,
      originalText: (raw.originalText.trim() || text).slice(0, 500),
      createdAt: raw.createdAt,
      roundSeq: room.game.roundSeq,
    };
    room.game.claims.push(claim);
    added.push(claim);
  }
  if (room.game.claims.length > CLAIM_CAP) room.game.claims.splice(0, room.game.claims.length - CLAIM_CAP);
  return added;
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
  if (!claim || claim.roundSeq !== room.game.roundSeq) return { ok: false, reason: 'That claim is not from this round.' };
  if (claim.speakerSessionId !== speaker.sessionId) return { ok: false, reason: 'That claim is not from the speaker who has the floor.' };
  const challenger = room.participants.get(challengerSessionId);
  if (!challenger || challenger.team === null) return { ok: false, reason: 'Join the room first.' };

  room.game.factCheckUsed.add(challengerSessionId);
  // The room is about to watch the jury; nobody else can open a check until it clears.
  room.game.considering.clear();
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
  return { ok: true, challenge };
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
    return had;
  }
  if (had || !canFactCheck(room, sessionId).ok) return false;
  room.game.considering.add(sessionId);
  return true;
}

/**
 * Resume after a verdict. Refuses while the referee is still working, so the room can read it.
 * `onlyId` is for the automatic resume: it does nothing if the host already moved on.
 */
export function dismissFactCheck(room: Room, now: number, onlyId?: string): { ok: true } | { ok: false; message: string } {
  if (room.status !== 'live' || !room.game.activeFactCheckId) return { ok: false, message: 'There is no fact check to dismiss.' };
  if (onlyId && room.game.activeFactCheckId !== onlyId) return { ok: false, message: 'That fact check already cleared.' };
  const challenge = room.game.factChecks.find((f) => f.id === room.game.activeFactCheckId);
  if (challenge?.status === 'checking') return { ok: false, message: 'The fact check is still running.' };
  room.game.activeFactCheckId = null;
  unfreezeClocks(room, now);
  return { ok: true };
}

/** Model said SUPPORTED/CONTRADICTED but was not confident enough: treat as no decision. */
export function coerceVerdict(verdict: string, confidence: number): FactVerdict | null {
  const v = verdict.trim().toUpperCase();
  if (v !== 'SUPPORTED' && v !== 'CONTRADICTED' && v !== 'INCONCLUSIVE') return null;
  if ((v === 'SUPPORTED' || v === 'CONTRADICTED') && !(confidence >= 0.8)) return 'INCONCLUSIVE';
  return v;
}
