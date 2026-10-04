import type { Participant, Room } from "./model";

/**
 * Who may publish audio right now. Single source of truth for both token minting
 * and live LiveKit permission updates.
 *
 * - Spectators never publish.
 * - Lobby / ended: all speakers may talk freely (setup and post-game chat).
 * - Live: ONLY the active side's hot-seat speaker, and only while the clock runs
 *   (paused, buzz-locked, or an open fact-check means nobody holds the floor).
 */
export function canPublish(room: Room, p: Participant): boolean {
  if (p.role !== "speaker") return false;
  if (room.status !== "live") return true;
  const g = room.game;
  if (
    g.paused ||
    g.buzz ||
    g.activeFactCheckId ||
    g.factCheckArmedBy ||
    g.activeSide === null
  )
    return false;
  return g.hotSeat[g.activeSide] === p.sessionId;
}
