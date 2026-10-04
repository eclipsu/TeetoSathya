import type { FactCheckOutcome, TeamIndex } from './types';

/** Who won a finished round. 'draw' only when the host calls it on a tie. */
export type RoundWinner = TeamIndex | 'draw';

/**
 * Fact-check points: a challenge that lands is +1 for the challenger's team,
 * one that fails is +1 for the speaker's team. No decision scores nothing.
 */
export function scoreFactChecks(checks: { outcome: FactCheckOutcome | null; challengerTeam: TeamIndex; speakerTeam: TeamIndex }[]): [number, number] {
  const score: [number, number] = [0, 0];
  for (const c of checks) {
    if (c.outcome === 'successful') score[c.challengerTeam] += 1;
    else if (c.outcome === 'failed') score[c.speakerTeam] += 1;
  }
  return score;
}

/** Higher score wins. A tie returns null: the host breaks it. */
export function winnerByScore(score: [number, number]): TeamIndex | null {
  if (score[0] === score[1]) return null;
  return score[0] > score[1] ? 0 : 1;
}
