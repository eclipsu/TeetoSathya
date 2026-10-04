import type { Role, TeamIndex } from '@teeto/shared';
import type { Participant, Room } from './model';

export type SetRoleResult =
  | { ok: true; changed: boolean; vacatedHotSeat: TeamIndex | null }
  | { ok: false; code: 'not_joined' | 'team_full' | 'bad_request' | 'invalid_state'; message: string };

export function speakersOnTeam(room: Room, team: TeamIndex): Participant[] {
  return [...room.participants.values()]
    .filter((p) => p.role === 'speaker' && p.team === team)
    .sort((a, b) => (a.seatOrder ?? 99) - (b.seatOrder ?? 99));
}

export function lowestFreeSeat(room: Room, team: TeamIndex, excludeSessionId?: string): number | null {
  const taken = new Set(speakersOnTeam(room, team).filter((p) => p.sessionId !== excludeSessionId).map((p) => p.seatOrder));
  for (let seat = 1; seat <= room.settings.speakersPerTeamMax; seat++) if (!taken.has(seat)) return seat;
  return null;
}

/**
 * Change a participant's role/team. All limits enforced here, synchronously, so two
 * simultaneous requests for the last seat can never both succeed.
 */
export function setRole(room: Room, sessionId: string, role: Role, team: TeamIndex | null): SetRoleResult {
  const p = room.participants.get(sessionId);
  if (!p) return { ok: false, code: 'not_joined', message: 'Join the room first.' };
  if (room.status === 'ended') return { ok: false, code: 'invalid_state', message: 'The round is over.' };
  if (role !== 'speaker' && role !== 'spectator') return { ok: false, code: 'bad_request', message: 'Unknown role.' };

  if (role === 'spectator') {
    if (p.role === 'spectator') return { ok: true, changed: false, vacatedHotSeat: null };
    const vacated = vacateHotSeat(room, sessionId);
    p.role = 'spectator';
    p.team = null;
    p.seatOrder = null;
    return { ok: true, changed: true, vacatedHotSeat: vacated };
  }

  if (team !== 0 && team !== 1) return { ok: false, code: 'bad_request', message: 'Pick team A or team B.' };
  if (p.role === 'speaker' && p.team === team) return { ok: true, changed: false, vacatedHotSeat: null };

  const seat = lowestFreeSeat(room, team, sessionId);
  if (seat === null) {
    return { ok: false, code: 'team_full', message: `${room.sides[team]} is full (${room.settings.speakersPerTeamMax} speakers max).` };
  }
  const vacated = vacateHotSeat(room, sessionId);
  p.role = 'speaker';
  p.team = team;
  p.seatOrder = seat;
  return { ok: true, changed: true, vacatedHotSeat: vacated };
}

/** If this participant is in a hot seat, empty it and return which side. */
export function vacateHotSeat(room: Room, sessionId: string): TeamIndex | null {
  const idx = room.game.hotSeat.indexOf(sessionId);
  if (idx === -1) return null;
  room.game.hotSeat[idx] = null;
  return idx as TeamIndex;
}
