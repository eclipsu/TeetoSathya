import type { TeamIndex } from './types';

/** Who won a finished round. 'draw' only when the host calls it on a tie. */
export type RoundWinner = TeamIndex | 'draw';

/** Higher score wins. A tie returns null: the host breaks it. */
export function winnerByScore(score: [number, number]): TeamIndex | null {
  if (score[0] === score[1]) return null;
  return score[0] > score[1] ? 0 : 1;
}
