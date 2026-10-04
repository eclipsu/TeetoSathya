import type { Participant, Room } from './model';

/**
 * Who may publish audio right now. Single source of truth for both token minting
 * and live LiveKit permission updates.
 *
 * - Spectators never publish.
 * - Lobby: all speakers may talk freely (setup).
 * - Ended: nobody. The voice room is torn down when the round ends.
 * - Jury tie-break: everyone in the room (push-to-talk on the client); transcription is off.
 * - Live: ONLY the active side's hot-seat speaker, and only while the clock runs
 *   (paused, buzz-locked, or an open fact-check means nobody holds the floor).
 */
export function canPublish(room: Room, p: Participant): boolean {
  if (room.status === 'ended') return false;
  // Jury tie-break: everyone may argue (each client gates its mic behind "hold P").
  const active = room.game.activeFactCheckId ? room.game.factChecks.find((f) => f.id === room.game.activeFactCheckId) : undefined;
  if (room.status === 'live' && active?.status === 'tiebreak') return true;
  if (p.role !== 'speaker') return false;
  if (room.status !== 'live') return true;
  const g = room.game;
  if (g.paused || g.buzz || g.activeFactCheckId || g.activeSide === null) return false;
  return g.hotSeat[g.activeSide] === p.sessionId;
}
