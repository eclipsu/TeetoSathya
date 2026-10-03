import type { GameView, ParticipantView, RoomSnapshot } from '@teeto/shared';
import type { Room } from './model';

/** The only way room state leaves the server. Strips sessionIds, socket ids and the host token. */
export function toSnapshot(room: Room, now: number): RoomSnapshot {
  const idOf = (sessionId: string | null) => (sessionId ? room.participants.get(sessionId)?.id ?? null : null);
  const participants: ParticipantView[] = [...room.participants.values()].map((p) => ({
    id: p.id,
    username: p.username,
    role: p.role,
    team: p.team,
    seatOrder: p.seatOrder,
    connected: p.connected,
    isHost: p.sessionId === room.hostSessionId,
    timeUsedMs: p.timeUsedMs,
  }));
  const g = room.game;
  const game: GameView = {
    hotSeat: [idOf(g.hotSeat[0]), idOf(g.hotSeat[1])],
    activeSide: g.activeSide,
    clocks: [g.clocks[0], g.clocks[1]],
    clockRunningSince: g.clockRunningSince,
    roundEndsAt: g.roundEndsAt,
    roundRemainingMs: g.roundRemainingMs,
    paused: g.paused,
    buzz: g.buzz
      ? { participantId: idOf(g.buzz.sessionId) ?? '', username: g.buzz.username, at: g.buzz.at, challengedParticipantId: idOf(g.buzz.challengedSessionId) }
      : null,
  };
  return { id: room.id, topic: room.topic, sides: room.sides, status: room.status, settings: room.settings, participants, game, serverNow: now };
}
