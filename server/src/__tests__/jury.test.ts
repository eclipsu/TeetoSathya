import { describe, expect, it } from 'vitest';
import type { JuryModel, JuryVote } from '@teeto/shared';
import { outcomeForVerdict, openFactCheck, resolveFactCheck } from '../domain/factcheck';
import { setRole } from '../domain/seats';
import * as game from '../domain/game';
import { join, makeRoom } from './helpers';
import { calculateJuryConfidence, calculateMajority, deliberationUser, peerAnalyses, topicVerdict } from '../services/factChecking/jury';
import { applyDeliberation, round1Schema } from '../services/factChecking/schemas';
import type { Round1Analysis } from '../services/factChecking/types';

function vote(model: JuryModel, finalVerdict: JuryVote['finalVerdict'], finalConfidence: number): JuryVote {
  return {
    model,
    role: model,
    initialVerdict: finalVerdict,
    initialConfidence: finalConfidence,
    finalVerdict,
    onTopic: true,
    finalConfidence,
    changedVote: false,
    reasoning: 'Known fact.',
    limitations: [],
    responseToOthers: 'No correction.',
  };
}

function analysis(model: JuryModel, verdict: Round1Analysis['verdict']): Round1Analysis {
  return {
    model,
    role: model,
    verdict,
    onTopic: true,
    confidence: 0.8,
    reasoning: `${model} reasoning`,
    spoken: `${model} says so`,
    keyBasis: [`${model} basis`],
    limitations: [`${model} limitation`],
  };
}

describe('jury majority', () => {
  it('a 3–0 incorrect ballot is incorrect at the winners’ average confidence', () => {
    const votes = [vote('gemini', 'INCORRECT', 0.99), vote('claude', 'INCORRECT', 0.99), vote('chatgpt', 'INCORRECT', 0.99)];
    const tally = calculateMajority(votes);
    expect(tally.verdict).toBe('INCORRECT');
    expect(tally.votesForIncorrect).toBe(3);
    expect(tally.votesForCorrect).toBe(0);
    expect(tally.unanimous).toBe(true);
    expect(tally.juryConfidence).toBe(0.99);
    expect(calculateJuryConfidence(votes, 'INCORRECT')).toBe(0.99);
  });

  it('a 2–1 split uses only the winning confidences, then multiplies by 0.90', () => {
    const votes = [vote('gemini', 'CORRECT', 0.91), vote('claude', 'INCORRECT', 0.58), vote('chatgpt', 'CORRECT', 0.86)];
    const tally = calculateMajority(votes);
    expect(tally.verdict).toBe('CORRECT');
    expect(tally.votesForCorrect).toBe(2);
    expect(tally.votesForIncorrect).toBe(1);
    expect(tally.unanimous).toBe(false);
    expect(tally.juryConfidence).toBe(Math.round(((0.91 + 0.86) / 2) * 0.9 * 1000) / 1000);
  });

  it('refuses to invent a result when a juror is missing', () => {
    expect(() => calculateMajority([vote('gemini', 'CORRECT', 0.9), vote('claude', 'CORRECT', 0.9)], 3)).toThrow(/3 final votes/);
  });

  it('with Claude unseated, two agreeing votes decide and a 1–1 split does not', () => {
    const agreed = calculateMajority([vote('gemini', 'INCORRECT', 0.92), vote('chatgpt', 'INCORRECT', 0.88)], 2);
    expect(agreed.verdict).toBe('INCORRECT');
    expect(agreed.unanimous).toBe(true);
    expect(agreed.juryConfidence).toBe(0.9);

    const split = calculateMajority([vote('gemini', 'CORRECT', 0.8), vote('chatgpt', 'INCORRECT', 0.7)], 2);
    expect(split.verdict).toBeNull();
    expect(split.votesForCorrect).toBe(1);
    expect(split.votesForIncorrect).toBe(1);
    expect(split.juryConfidence).toBe(0);
  });
});

describe('jury schemas', () => {
  it('rejects an abstention and an out-of-range confidence', () => {
    const base = { onTopic: true, confidence: 0.8, reasoning: 'Because.', keyBasis: ['fact'], limitations: ['none known'] };
    expect(() => round1Schema.parse({ ...base, verdict: 'INCONCLUSIVE' })).toThrow();
    expect(() => round1Schema.parse({ ...base, verdict: 'CORRECT', confidence: 150 })).toThrow();
    expect(round1Schema.parse({ ...base, verdict: 'CORRECT', confidence: 85 }).confidence).toBe(0.85);
  });

  it('keeps the server’s Round 1 vote and computes changedVote itself', () => {
    const own = analysis('claude', 'CORRECT');
    const held = applyDeliberation(own, JSON.stringify({
      initialVerdict: 'INCORRECT',
      initialConfidence: 0.1,
      finalVerdict: 'CORRECT',
      onTopic: true,
      finalConfidence: 0.7,
      changedVote: true,
      responseToOthers: 'Their objection does not land.',
      finalReasoning: 'The statement still holds.',
    }));
    expect(held.initialVerdict).toBe('CORRECT');
    expect(held.initialConfidence).toBe(0.8);
    expect(held.changedVote).toBe(false);

    const flipped = applyDeliberation(own, JSON.stringify({
      initialVerdict: 'CORRECT',
      initialConfidence: 0.8,
      finalVerdict: 'INCORRECT',
      onTopic: true,
      finalConfidence: 0.66,
      changedVote: false,
      responseToOthers: 'The qualifier was missed.',
      finalReasoning: 'The absolute wording fails.',
    }));
    expect(flipped.changedVote).toBe(true);
    expect(flipped.finalVerdict).toBe('INCORRECT');
    expect(flipped.model).toBe('claude');
  });

  it('forces an off-topic claim to incorrect', () => {
    const own = analysis('gemini', 'CORRECT');
    const forced = applyDeliberation(own, JSON.stringify({
      initialVerdict: 'CORRECT',
      initialConfidence: 0.9,
      finalVerdict: 'CORRECT',
      onTopic: false,
      finalConfidence: 0.9,
      changedVote: false,
      responseToOthers: 'True, but not about this debate.',
      finalReasoning: 'The fact is about a different subject.',
    }));
    expect(forced.onTopic).toBe(false);
    expect(forced.finalVerdict).toBe('INCORRECT');
    expect(topicVerdict([forced, { onTopic: false }], 'CORRECT')).toEqual({ verdict: 'INCORRECT', offTopic: true });
    expect(topicVerdict([forced, { onTopic: true }], null)).toEqual({ verdict: null, offTopic: false });
  });
});

describe('deliberation packet', () => {
  it('shows each juror only the other two analyses, with no tally', () => {
    const round1 = [analysis('gemini', 'CORRECT'), analysis('claude', 'INCORRECT'), analysis('chatgpt', 'CORRECT')];
    const self = round1[1]!;
    const peers = peerAnalyses(self, round1);
    expect(peers.map((item) => item.model)).toEqual(['gemini', 'chatgpt']);
    const packet = deliberationUser('The capital of Australia is Sydney.', self, peers);
    expect(packet).toContain('The capital of Australia is Sydney.');
    expect(packet).toContain('gemini reasoning');
    expect(packet).toContain('chatgpt reasoning');
    expect(packet).not.toMatch(/majority|consensus|votesFor/i);
  });
});

describe('challenge outcome', () => {
  it('maps an incorrect jury vote to a successful challenge and a correct one to a failed challenge', () => {
    expect(outcomeForVerdict('INCORRECT')).toBe('successful');
    expect(outcomeForVerdict('CORRECT')).toBe('failed');
    expect(outcomeForVerdict('CORRECT', true)).toBe('no_decision');

    const room = makeRoom();
    join(room, room.hostSessionId, 'Host');
    setRole(room, room.hostSessionId, 'speaker', 0);
    join(room, 'sess-b2-00001', 'B2');
    setRole(room, 'sess-b2-00001', 'speaker', 1);
    if (!game.startRound(room, 1_000_000).ok) throw new Error('round did not start');
    room.game.claims.push({
      id: 'c1', roomId: room.id, text: 'The capital of Australia is Sydney.', originalText: 'The capital of Australia is Sydney.',
      speakerSessionId: room.hostSessionId, team: 0, createdAt: 1, roundSeq: room.game.roundSeq, relevance: 1, updatedAt: null, evictedAt: null,
    });
    expect(openFactCheck(room, 'sess-b2-00001', 'c1', 1_001_000, 'fc1').ok).toBe(true);
    const resolved = resolveFactCheck(room, 'fc1', {
      verdict: 'INCORRECT',
      confidence: 0.99,
      explanation: '3–0 INCORRECT',
      jury: {
        claimId: 'c1',
        claim: 'The capital of Australia is Sydney.',
        verdict: 'INCORRECT',
        votesForCorrect: 0,
        votesForIncorrect: 3,
        juryConfidence: 0.99,
        unanimous: true,
        offTopic: false,
        votes: [vote('gemini', 'INCORRECT', 0.99), vote('claude', 'INCORRECT', 0.99), vote('chatgpt', 'INCORRECT', 0.99)],
        completedAt: 1,
      },
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.challenge.outcome).toBe('successful');
      expect(resolved.challenge.juryPhase).toBeNull();
      expect(resolved.challenge.jury?.votes).toHaveLength(3);
    }
  });
});

describe('one cycle for settled facts', () => {
  it('skips the reply round when every juror already agrees confidently', async () => {
    const { settledAtOnce } = await import('../services/factChecking/jury');
    expect(settledAtOnce([{ verdict: 'INCORRECT', confidence: 0.97 }, { verdict: 'INCORRECT', confidence: 0.92 }])).toBe(true);
    expect(settledAtOnce([{ verdict: 'INCORRECT', confidence: 0.97 }, { verdict: 'INCORRECT', confidence: 0.7 }])).toBe(false);
    expect(settledAtOnce([{ verdict: 'INCORRECT', confidence: 0.97 }, { verdict: 'CORRECT', confidence: 0.95 }])).toBe(false);
  });
});
