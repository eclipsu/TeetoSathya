import type { RoomSnapshot } from '@teeto/shared';

/** Client-side mirror of the server mic policy, used only to EXPLAIN why the mic is closed. */
export function micClosedReason(s: RoomSnapshot, myId: string | null): string | null {
  const me = s.participants.find((p) => p.id === myId);
  if (s.status === 'ended') return 'Round over — voice closed';
  if (!me || me.role !== 'speaker') return 'Spectators listen only';
  if (s.status !== 'live') return null;
  const g = s.game;
  if (g.factCheck) return 'Fact check — mic off';
  if (g.buzz) return 'Buzz in progress';
  if (g.paused) return 'Round paused';
  const mySide = g.hotSeat.indexOf(me.id);
  if (mySide === -1) return 'Only the hot-seat speaker can talk';
  if (g.activeSide !== mySide) return "Wait for your turn";
  return null;
}

export type SpaceAction =
  | { action: 'buzz' | 'done'; label: string }
  | { action: null; label: string | null; reason: string };

/**
 * What SPACE does for this viewer right now. Mirrors the server rules for UI only;
 * the server re-validates every press. `label` is what SPACE would do for this role.
 */
export function spaceAction(s: RoomSnapshot, myId: string | null): SpaceAction {
  const me = s.participants.find((p) => p.id === myId);
  const g = s.game;
  if (!me) return { action: null, label: null, reason: 'Joining…' };
  const mySide = g.hotSeat.indexOf(me.id);
  const label = me.role === 'spectator' ? 'BUZZ IN' : mySide !== -1 ? "I'M DONE" : null;
  if (me.role === null) return { action: null, label, reason: 'Pick a role first' };
  if (s.status === 'lobby') return { action: null, label, reason: 'Round not live yet' };
  if (s.status === 'ended') return { action: null, label, reason: 'Round over' };
  if (g.factCheck) return { action: null, label, reason: `${g.factCheck.challengerName} called a fact check. ${g.factCheck.speakerName}, your mic is off.` };
  if (g.buzz) return { action: null, label, reason: `${g.buzz.username} buzzed in. Waiting for the host` };
  if (g.paused) return { action: null, label, reason: 'Round paused' };
  if (me.role === 'spectator') return { action: 'buzz', label: 'BUZZ IN' };
  if (mySide !== -1 && g.activeSide === mySide) return { action: 'done', label: "I'M DONE" };
  if (mySide !== -1) return { action: null, label, reason: "You're in the hot seat. Wait for your turn" };
  return { action: null, label, reason: "You're on the bench. Only spectators can buzz in" };
}
