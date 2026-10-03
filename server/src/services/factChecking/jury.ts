import { JURY_SEATS, type JuryModel, type JuryResult, type JuryVote } from '@teeto/shared';
import { claudeDeliberate, claudeIndependent } from './claudeJuror';
import { geminiDeliberate, geminiIndependent } from './geminiJuror';
import { chatgptDeliberate, chatgptIndependent } from './openaiJuror';
import { JuryFailure, type Round1Analysis } from './types';

const ATTEMPT_MS = 18_000;

/**
 * Jury confidence:
 *   winningConfidence = average(finalConfidence of jurors who voted for the winning verdict)
 *   unanimous (every seated juror agrees): juryConfidence = winningConfidence
 *   split (a majority, but not all): juryConfidence = winningConfidence * 0.90
 * Losing votes are not averaged in. They are shown on their own.
 */
export function calculateJuryConfidence(votes: JuryVote[], verdict: JuryVote['finalVerdict']): number {
  const winners = votes.filter((vote) => vote.finalVerdict === verdict);
  if (!winners.length) throw new Error('Winning side has no votes.');
  const average = winners.reduce((sum, vote) => sum + vote.finalConfidence, 0) / winners.length;
  const unanimous = winners.length === votes.length;
  const score = unanimous ? average : average * 0.9;
  return Math.round(score * 1000) / 1000;
}

/** Strict majority of the seated jurors' FINAL votes. A tie returns a null verdict. */
export function calculateMajority(votes: JuryVote[], seats = 3): Pick<JuryResult, 'verdict' | 'votesForCorrect' | 'votesForIncorrect' | 'juryConfidence' | 'unanimous'> {
  if (votes.length !== seats) throw new Error(`Jury requires ${seats} final votes.`);
  const votesForCorrect = votes.filter((vote) => vote.finalVerdict === 'CORRECT').length;
  const votesForIncorrect = votes.length - votesForCorrect;
  if (votesForCorrect === votesForIncorrect) {
    return { verdict: null, votesForCorrect, votesForIncorrect, unanimous: false, juryConfidence: 0 };
  }
  const verdict = votesForCorrect > votesForIncorrect ? 'CORRECT' : 'INCORRECT';
  return {
    verdict,
    votesForCorrect,
    votesForIncorrect,
    unanimous: votesForCorrect === seats || votesForIncorrect === seats,
    juryConfidence: calculateJuryConfidence(votes, verdict),
  };
}

/** The other two Round 1 analyses only. No tally, no "who is ahead". */
export function peerAnalyses(self: Round1Analysis, round1: Round1Analysis[]): Round1Analysis[] {
  return round1.filter((analysis) => analysis.model !== self.model);
}

export function deliberationUser(claim: string, own: Round1Analysis, others: Round1Analysis[]): string {
  const brief = (analysis: Round1Analysis) => ({
    model: analysis.model,
    role: analysis.role,
    verdict: analysis.verdict,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    keyBasis: analysis.keyBasis,
    limitations: analysis.limitations,
  });
  return [
    'ORIGINAL CLAIM:',
    `"""${claim}"""`,
    '',
    'YOUR OWN INDEPENDENT ANALYSIS:',
    JSON.stringify(brief(own)),
    '',
    others.length === 1 ? 'THE OTHER SEATED JUROR, WRITTEN BEFORE THEY SAW ANYONE ELSE:' : 'THE OTHER SEATED JURORS, EACH WRITTEN BEFORE THEY SAW ANYONE ELSE:',
    ...others.map((analysis) => JSON.stringify(brief(analysis))),
    '',
    'Re-evaluate the original claim. Those statements are arguments, not verified evidence.',
  ].join('\n');
}

function safeMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'provider request failed';
  if (/api[_-]?key|sk-|AIza|bearer /i.test(message)) return 'provider request failed';
  return message.slice(0, 180);
}

async function attempt<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const run = () => fn(AbortSignal.timeout(ATTEMPT_MS));
  try {
    return await run();
  } catch (err) {
    if (err instanceof JuryFailure) throw err;
    console.warn(`[jury] ${label} failed, retrying once: ${safeMessage(err)}`);
    try {
      return await run();
    } catch (again) {
      if (again instanceof JuryFailure) throw again;
      throw new Error(`${label}: ${safeMessage(again)}`);
    }
  }
}

export interface JuryProgress {
  phase: 'independent' | 'deliberating';
}

const SEATS: Record<JuryModel, {
  independent: (claim: string, signal: AbortSignal) => Promise<Round1Analysis>;
  deliberate: (packet: string, own: Round1Analysis, signal: AbortSignal) => Promise<JuryVote>;
}> = {
  gemini: { independent: geminiIndependent, deliberate: geminiDeliberate },
  claude: { independent: claudeIndependent, deliberate: claudeDeliberate },
  chatgpt: { independent: chatgptIndependent, deliberate: chatgptDeliberate },
};

/**
 * Round 1 in parallel (each seated model sees only the claim), then Round 2 in parallel
 * (each seated model sees the other seated analyses). The tally is not a model call.
 */
export async function runJury(claimId: string, claim: string, onPhase?: (phase: JuryProgress['phase']) => Promise<void> | void): Promise<JuryResult> {
  await onPhase?.('independent');
  const round1 = await Promise.all(JURY_SEATS.map((model) => attempt(model, (signal) => SEATS[model].independent(claim, signal))));

  await onPhase?.('deliberating');
  const votes = await Promise.all(round1.map((own) => {
    const packet = deliberationUser(claim, own, peerAnalyses(own, round1));
    return attempt(`${own.model} deliberation`, (signal) => SEATS[own.model].deliberate(packet, own, signal));
  }));

  const tally = calculateMajority(votes, JURY_SEATS.length);
  return {
    claimId,
    claim,
    ...tally,
    votes,
    completedAt: Date.now(),
  };
}
