import { describe, expect, it } from 'vitest';
import * as game from '../domain/game';
import { setRole } from '../domain/seats';
import { canPublish } from '../domain/micPolicy';
import {
  addJuryMessage,
  beginFactCheckCountdown,
  FACT_CHECK_RESUME_MS,
  canFactCheck,
  coerceVerdict,
  dismissFactCheck,
  getRecentClaims,
  mergeClaims,
  openFactCheck,
  resolveFactCheck,
  setConsidering,
  setJuryThinking,
} from '../domain/factcheck';
import { join, makeRoom } from './helpers';
import type { Room } from '../domain/model';
import type { TeamIndex } from '@teeto/shared';

const T0 = 1_000_000;
const TURN = 60_000;

function liveRoom(): Room {
  const room = makeRoom();
  join(room, room.hostSessionId, 'Host');
  setRole(room, room.hostSessionId, 'speaker', 0);
  for (const [sid, name, team] of [['sess-a2-00001', 'A2', 0], ['sess-b1-00001', 'B1', 1], ['sess-b2-00001', 'B2', 1]] as const) {
    join(room, sid, name);
    setRole(room, sid, 'speaker', team);
  }
  join(room, 'sess-spec-0001', 'Spec');
  setRole(room, 'sess-spec-0001', 'spectator', null);
  const started = game.startRound(room, T0);
  if (!started.ok) throw new Error(started.message);
  return room;
}

function addClaim(room: Room, speakerSessionId: string, team: TeamIndex, id: string, text: string, createdAt = 1) {
  mergeClaims(room, [{ id, text, originalText: text, speakerSessionId, team, createdAt }]);
}

describe('fact-check eligibility', () => {
  it('browsing claims does not pause the round or cut the speaker mic', () => {
    const room = liveRoom();
    const speaker = room.participants.get(room.hostSessionId)!;
    expect(canFactCheck(room, 'sess-b1-00001').ok).toBe(true);
    expect(room.game.paused).toBe(false);
    expect(canPublish(room, speaker)).toBe(true);
  });

  it('the active speaker cannot fact check', () => {
    const room = liveRoom();
    const res = canFactCheck(room, room.hostSessionId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/speaking/i);
  });

  it('a same-team participant cannot fact check their own side', () => {
    const room = liveRoom();
    const res = canFactCheck(room, 'sess-a2-00001');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/own side/i);
  });

  it('a spectator cannot use team fact check', () => {
    const room = liveRoom();
    expect(canFactCheck(room, 'sess-spec-0001').ok).toBe(false);
  });

  it('an opposing teammate who is not publishing can fact check, including the listening hot seat', () => {
    const room = liveRoom();
    expect(room.game.hotSeat[1]).toBe('sess-b1-00001');
    expect(canFactCheck(room, 'sess-b1-00001').ok).toBe(true);
    expect(canFactCheck(room, 'sess-b2-00001').ok).toBe(true);
    expect(room.game.factCheckUsed.size).toBe(0);
  });

  it('a participant cannot submit a second fact check in the same round', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The capital of Australia is Sydney.');
    expect(openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 1000, 'fc1').ok).toBe(true);
    resolveFactCheck(room, 'fc1', { verdict: 'CONTRADICTED', confidence: 0.9, explanation: 'Sydney is not the capital.' });
    expect(dismissFactCheck(room, T0 + 2000).ok).toBe(true);
    const again = openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 3000, 'fc2');
    expect(again.ok).toBe(false);
    expect(room.game.factChecks.filter((f) => f.challengerSessionId === 'sess-b2-00001')).toHaveLength(1);
  });

  it('a new round resets fact-check eligibility and clears round claims', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The capital of Australia is Sydney.');
    openFactCheck(room, 'sess-b1-00001', 'c1', T0 + 1000, 'fc1');
    resolveFactCheck(room, 'fc1', { verdict: 'CONTRADICTED', confidence: 0.95, explanation: 'No.' });
    dismissFactCheck(room, T0 + 2000);
    room.status = 'lobby';
    const started = game.startRound(room, T0 + 10_000);
    expect(started.ok).toBe(true);
    expect(room.game.factCheckUsed.size).toBe(0);
    expect(room.game.claims).toHaveLength(0);
    expect(room.game.factChecks).toHaveLength(0);
    expect(canFactCheck(room, 'sess-b1-00001').ok).toBe(true);
    expect(canFactCheck(room, 'sess-b2-00001').ok).toBe(true);
  });
});

describe('recent claims', () => {
  it('returns only the current opposing speaker’s claims', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'h1', 'The United States has 50 states.');
    addClaim(room, 'sess-a2-00001', 0, 'm1', 'Canberra is the capital of Australia.');
    const recent = getRecentClaims(room, room.hostSessionId, 4);
    expect(recent.map((c) => c.id)).toEqual(['h1']);
    expect(getRecentClaims(room, 'sess-a2-00001', 4).map((c) => c.id)).toEqual(['m1']);
  });

  it('returns at most the four latest claims, newest first', () => {
    const room = liveRoom();
    for (let i = 1; i <= 6; i++) addClaim(room, room.hostSessionId, 0, `c${i}`, `Claim number ${i} is a fact.`, i);
    expect(getRecentClaims(room, room.hostSessionId, 4).map((c) => c.id)).toEqual(['c6', 'c5', 'c4', 'c3']);
  });

  it("does not offer another room's claims for the same speaker", () => {
    const here = liveRoom();
    const there = liveRoom();
    addClaim(here, here.hostSessionId, 0, 'here', 'This room said the sky is blue.');
    addClaim(there, there.hostSessionId, 0, 'there', 'The other room said the sky is green.');
    there.game.claims.push({
      id: 'carried',
      roomId: here.id,
      speakerSessionId: there.hostSessionId,
      team: 0,
      text: 'A fact carried over from the other room.',
      originalText: 'A fact carried over from the other room.',
      createdAt: 3,
      roundSeq: there.game.roundSeq,
    });
    expect(getRecentClaims(here, here.hostSessionId).map((c) => c.id)).toEqual(['here']);
    expect(getRecentClaims(there, there.hostSessionId).map((c) => c.id)).toEqual(['there']);
    const challenged = openFactCheck(there, 'sess-b1-00001', 'carried', T0 + 1000, 'fc-cross');
    expect(challenged.ok).toBe(false);
  });

  it('does not store the same claim twice for one speaker', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'YouTube was founded in 2005.');
    addClaim(room, room.hostSessionId, 0, 'c2', 'YouTube was founded in 2005.');
    expect(room.game.claims).toHaveLength(1);
  });
});

describe('submitting a challenge', () => {
  it('pauses both clocks and the round clock without switching the floor', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'Australia has more than 100 million people.');
    const opened = openFactCheck(room, 'sess-b1-00001', 'c1', T0 + 10_000, 'fc1');
    expect(opened.ok).toBe(true);
    expect(room.game.paused).toBe(true);
    expect(room.game.activeSide).toBe(0);
    expect(room.game.activeFactCheckId).toBe('fc1');
    expect(game.clockRemaining(room, 0, T0 + 99_000)).toBe(TURN - 10_000);
    expect(room.game.roundRemainingMs).toBe(600_000 - 10_000);
    expect(game.nextDeadline(room)).toBeNull();
    expect(room.game.factCheckUsed.has('sess-b1-00001')).toBe(true);
    expect(dismissFactCheck(room, T0 + 12_000).ok).toBe(false);
  });

  it('SUPPORTED is a failed challenge', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The United States has 50 states.');
    openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 1000, 'fc1');
    const resolved = resolveFactCheck(room, 'fc1', { verdict: 'SUPPORTED', confidence: 0.95, explanation: 'There are 50 states.' });
    expect(resolved.ok && resolved.challenge.outcome).toBe('failed');
    expect(room.game.scores).toEqual([0, -50]);
  });

  it('CONTRADICTED is a successful challenge', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The capital of Australia is Sydney.');
    openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 1000, 'fc1');
    const resolved = resolveFactCheck(room, 'fc1', { verdict: 'CONTRADICTED', confidence: 0.99, explanation: 'The capital is Canberra.' });
    expect(resolved.ok && resolved.challenge.outcome).toBe('successful');
    expect(room.game.scores).toEqual([0, 100]);
    expect(resolveFactCheck(room, 'fc1', { verdict: 'CONTRADICTED', confidence: 0.99, explanation: 'The capital is Canberra.' }).ok).toBe(false);
    expect(room.game.scores).toEqual([0, 100]);
    expect(dismissFactCheck(room, T0 + 2000).ok).toBe(true);
    expect(room.game.paused).toBe(false);
    expect(room.game.activeSide).toBe(0);
  });

  it('counts down and then resumes on its own', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The capital of Australia is Sydney.');
    openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 1000, 'fc1');
    resolveFactCheck(room, 'fc1', { verdict: 'CONTRADICTED', confidence: 0.99, explanation: 'The capital is Canberra.' });
    beginFactCheckCountdown(room, T0 + 2000);
    const resumeAt = T0 + 2000 + FACT_CHECK_RESUME_MS;
    expect(room.game.paused).toBe(true);
    expect(game.nextDeadline(room)).toBe(resumeAt);
    game.tick(room, resumeAt - 1);
    expect(room.game.paused).toBe(true);
    expect(room.game.activeFactCheckId).toBe('fc1');
    const resumed = game.tick(room, resumeAt);
    expect(resumed.ok).toBe(true);
    expect(room.game.paused).toBe(false);
    expect(room.game.activeFactCheckId).toBeNull();
    expect(room.game.factCheckResumeAt).toBeNull();
    expect(room.game.activeSide).toBe(0);
  });

  it('INCONCLUSIVE is no decision', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'Apple is the biggest company in the world.');
    openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 1000, 'fc1');
    const resolved = resolveFactCheck(room, 'fc1', { verdict: 'INCONCLUSIVE', confidence: 0.4, explanation: 'Biggest depends on the metric.' });
    expect(resolved.ok && resolved.challenge.outcome).toBe('no_decision');
  });

  it('rejects a claim that is not from the current speaker and does not consume the attempt', () => {
    const room = liveRoom();
    addClaim(room, 'sess-a2-00001', 0, 'stale', 'Canberra is the capital of Australia.');
    const opened = openFactCheck(room, 'sess-b1-00001', 'stale', T0 + 1000, 'fc1');
    expect(opened.ok).toBe(false);
    expect(room.game.factCheckUsed.has('sess-b1-00001')).toBe(false);
    expect(room.game.activeFactCheckId).toBeNull();
    expect(room.game.paused).toBe(false);
  });

  it('two submissions cannot create two active challenges', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The Moon is larger than Earth.');
    const first = openFactCheck(room, 'sess-b1-00001', 'c1', T0 + 1000, 'fc1');
    const second = openFactCheck(room, 'sess-b2-00001', 'c1', T0 + 1000, 'fc2');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(room.game.factChecks).toHaveLength(1);
    expect(room.game.activeFactCheckId).toBe('fc1');
    expect(room.game.factCheckUsed.has('sess-b1-00001')).toBe(true);
    expect(room.game.factCheckUsed.has('sess-b2-00001')).toBe(false);
  });
});

describe('jury conversation', () => {
  it('appends juror messages in arrival order and clears thinking on resolve', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'Water boils at 90C at sea level.');
    expect(openFactCheck(room, 'sess-b1-00001', 'c1', T0 + 1000, 'fc1').ok).toBe(true);
    expect(setJuryThinking(room, 'fc1', ['gemini', 'claude'])).toBe(true);
    const msg = { stage: 'opening' as const, verdict: 'INCORRECT' as const, confidence: 0.9, text: 'It boils at 100C.', changedVote: false, at: T0 + 2000 };
    addJuryMessage(room, 'fc1', { ...msg, id: 'm1', model: 'claude' });
    const fc = room.game.factChecks[0]!;
    expect(fc.thread.map((m) => m.model)).toEqual(['claude']);
    expect(fc.thinking).toEqual(['gemini']);
    addJuryMessage(room, 'fc1', { ...msg, id: 'm2', model: 'gemini' });
    expect(fc.thinking).toEqual([]);
    resolveFactCheck(room, 'fc1', { verdict: 'INCORRECT', confidence: 0.9, explanation: '2–0 INCORRECT' });
    expect(addJuryMessage(room, 'fc1', { ...msg, id: 'm3', model: 'gemini' })).toBe(false);
    expect(fc.thread).toHaveLength(2);
  });
});

describe('verdict coercion', () => {
  it('downgrades a low-confidence decisive verdict to inconclusive', () => {
    expect(coerceVerdict('SUPPORTED', 0.79)).toBe('INCONCLUSIVE');
    expect(coerceVerdict('CONTRADICTED', 0.8)).toBe('CONTRADICTED');
    expect(coerceVerdict('nope', 1)).toBeNull();
  });
});

describe('considering a challenge', () => {
  it('shows only for someone who could challenge, and clears when they submit', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The capital of Australia is Sydney.');
    expect(setConsidering(room, 'sess-spec-0001', true)).toBe(false);
    expect(setConsidering(room, 'sess-b1-00001', true)).toBe(true);
    expect(room.game.paused).toBe(false);
    expect(openFactCheck(room, 'sess-b1-00001', 'c1', T0 + 1000, 'fc1').ok).toBe(true);
    expect(room.game.considering.size).toBe(0);
  });
});

describe('round winner', () => {
  it('a landed challenge scores +100 for the challenger and decides the winner', () => {
    const room = liveRoom();
    addClaim(room, room.hostSessionId, 0, 'c1', 'The capital of Australia is Sydney.');
    openFactCheck(room, 'sess-b1-00001', 'c1', T0 + 1000, 'fc1');
    resolveFactCheck(room, 'fc1', { verdict: 'INCORRECT', confidence: 0.9, explanation: 'No.' });
    dismissFactCheck(room, T0 + 2000);
    expect(game.endRound(room, T0 + 3000).ok).toBe(true);
    expect(room.game.winner).toBe(1);
    expect(game.pickWinner(room, 0).ok).toBe(false);
  });

  it('a tie waits for the host, who can pick once', () => {
    const room = liveRoom();
    expect(game.pickWinner(room, 0).ok).toBe(false);
    game.endRound(room, T0 + 3000);
    expect(room.game.winner).toBe(null);
    expect(game.pickWinner(room, 'draw').ok).toBe(true);
    expect(room.game.winner).toBe('draw');
    expect(game.pickWinner(room, 1).ok).toBe(false);
  });
});
