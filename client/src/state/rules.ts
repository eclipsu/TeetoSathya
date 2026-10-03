import type { RoomSnapshot } from '@teeto/shared';

/** Client-side mirror of the server mic policy, used only to EXPLAIN why the mic is closed. */
export function micClosedReason(s: RoomSnapshot, myId: string | null): string | null {
  const me = s.participants.find((p) => p.id === myId);
  if (!me || me.role !== 'speaker') return 'Spectators listen only';
  if (s.status !== 'live') return null;
  const g = s.game;
  if (g.buzz) return 'Buzz in progress';
  if (g.paused) return 'Round paused';
  const mySide = g.hotSeat.indexOf(me.id);
  if (mySide === -1) return 'Only the hot-seat speaker can talk';
  if (g.activeSide !== mySide) return "Wait for your turn";
  return null;
}
