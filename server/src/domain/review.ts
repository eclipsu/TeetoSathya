import type { PlayerReview, TeamIndex } from '@teeto/shared';
import type { Room } from './model';

/**
 * Each speaker's game, from the room's record (claims, fact checks, talk time): the numbers the
 * end-of-game review talks about. Pure, so it is computed the moment the game ends.
 */
export function playerStats(room: Room): PlayerReview[] {
  const g = room.game;
  const out: PlayerReview[] = [];
  for (const p of room.participants.values()) {
    if (p.role !== 'speaker' || p.team === null) continue;
    const mine = g.claims.filter((c) => c.speakerSessionId === p.sessionId);
    const against = g.factChecks.filter((f) => f.speakerSessionId === p.sessionId && f.outcome && f.outcome !== 'no_decision');
    const called = g.factChecks.filter((f) => f.challengerSessionId === p.sessionId);
    const roundClaim = g.roundClaim && mine.find((c) => c.id === g.roundClaim!.claimId);
    const best = roundClaim ?? [...mine].sort((a, b) => b.relevance - a.relevance || a.createdAt - b.createdAt)[0];
    out.push({
      id: p.id,
      name: p.username,
      team: p.team as TeamIndex,
      claims: mine.length,
      checked: against.length,
      stood: against.filter((f) => f.outcome === 'failed').length,
      challenges: called.length,
      landed: called.filter((f) => f.outcome === 'successful').length,
      outs: against.filter((f) => f.outcome === 'successful').length,
      points: called.reduce((sum, f) => sum + (f.scoreDelta ?? 0), 0),
      talkMs: (g.talkTotals.get(p.sessionId) ?? 0) + p.timeUsedMs,
      leanedOn: best?.text ?? null,
    });
  }
  return out.sort((a, b) => a.team - b.team || b.talkMs - a.talkMs);
}
