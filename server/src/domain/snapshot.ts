import { scoreFactChecks, type FactCheckView, type GameView, type ParticipantView, type RoomSnapshot } from '@teeto/shared';
import type { FactCheckChallenge, Room } from './model';

function toFactCheckView(f: FactCheckChallenge): FactCheckView {
  return {
    id: f.id,
    challengerId: f.challengerId,
    challengerName: f.challengerName,
    speakerId: f.speakerId,
    speakerName: f.speakerName,
    claim: f.claim,
    status: f.status,
    verdict: f.verdict,
    outcome: f.outcome,
    explanation: f.explanation,
    unavailable: f.unavailable,
    juryPhase: f.juryPhase,
    jury: f.jury,
    thread: f.thread,
    thinking: f.thinking,
    createdAt: f.createdAt,
  };
}

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
    round: g.roundSeq,
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
    factCheck: (() => {
      const active = g.activeFactCheckId ? g.factChecks.find((f) => f.id === g.activeFactCheckId) : undefined;
      return active ? toFactCheckView(active) : null;
    })(),
    factChecks: g.factChecks.map(toFactCheckView),
    factCheckUsedIds: [...g.factCheckUsed].map((sid) => idOf(sid)).filter((id): id is string => !!id),
    consideringIds: [...g.considering].map((sid) => idOf(sid)).filter((id): id is string => !!id),
    score: scoreFactChecks(g.factChecks),
    winner: room.status === 'ended' ? g.winner : null,
  };
  return { id: room.id, topic: room.topic, sides: room.sides, status: room.status, settings: room.settings, participants, game, serverNow: now };
}
