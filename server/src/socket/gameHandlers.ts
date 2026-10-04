import { validateRoomInput, type TeamIndex } from '@teeto/shared';
import type { Room } from '../domain/model';
import * as game from '../domain/game';
import type { GameResult } from '../domain/game';
import { onBuzzResolved } from '../seams/challenge';
import { TokenBucket } from './rateLimit';
import { HandlerError, type AppSocket, type RoomHub } from './hub';

/** Host controls, "done speaking" and the buzzer. All rules live in domain/game.ts. */
export function installGameHandlers(hub: RoomHub) {
  // Per-session buzz limiter (separate from the general socket limiter): 3 presses, refills 1 per 2s.
  const buzzLimiters = new Map<string, TokenBucket>();

  /** Run a game transition inside store.update, then toast + broadcast. */
  async function apply(roomId: string, fn: (room: Room, now: number) => GameResult) {
    const out = await hub.store.update(roomId, (room) => ({ room, res: fn(room, Date.now()) }));
    if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
    if (!out.res.ok) throw new HandlerError('invalid_state', out.res.message);
    for (const t of out.res.toasts) hub.toastRoom(roomId, t.type, t.message);
    await hub.changed(out.room);
  }

  const sessionOf = (room: Room, participantId: unknown) => {
    for (const p of room.participants.values()) if (p.id === participantId) return p.sessionId;
    throw new HandlerError('bad_request', 'Unknown participant.');
  };
  const sideOf = (side: unknown): TeamIndex => {
    if (side !== 0 && side !== 1) throw new HandlerError('bad_request', 'Unknown side.');
    return side;
  };

  hub.io.on('connection', (socket: AppSocket) => {
    hub.handle(socket, 'host:startRound', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      await apply(room.id, game.startRound);
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:setHotSeat', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const side = sideOf(p.side);
      const sessionId = sessionOf(room, p.participantId);
      await apply(room.id, (r, now) => game.setHotSeat(r, side, sessionId, now));
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:nextTurn', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      await apply(room.id, game.hostSwitchTurn);
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:rotateSpeaker', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const side = sideOf(p.side);
      await apply(room.id, (r, now) => game.rotateSpeaker(r, side, now));
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:pause', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      await apply(room.id, game.pause);
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:resume', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      await apply(room.id, game.resume);
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:endRound', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      await apply(room.id, game.endRound);
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:pickWinner', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const winner = p?.winner;
      if (winner !== 0 && winner !== 1 && winner !== 'draw') throw new HandlerError('bad_request', 'Pick a side or a draw.');
      await apply(room.id, (r) => game.pickWinner(r, winner));
      ack?.({ ok: true });
    });

    hub.handle(socket, 'host:settings', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const parsed = validateRoomInput({ topic: room.topic, sides: room.sides, turnSeconds: p?.turnSeconds, roundSeconds: p?.roundSeconds });
      if (!parsed.ok) throw new HandlerError('bad_request', parsed.errors[0]!);
      await apply(room.id, (r) => game.updateSettings(r, parsed.value.turnSeconds, parsed.value.roundSeconds));
      ack?.({ ok: true });
    });

    hub.handle(socket, 'turn:done', async (ack) => {
      const room = await hub.requireRoom(socket);
      await apply(room.id, (r, now) => game.turnDone(r, socket.data.sessionId, now));
      ack?.({ ok: true });
    });

    hub.handle(socket, 'buzz:press', async (_p, ack) => {
      const sessionId = socket.data.sessionId;
      let limiter = buzzLimiters.get(sessionId);
      if (!limiter) buzzLimiters.set(sessionId, (limiter = new TokenBucket(3, 0.5)));
      if (!limiter.take()) throw new HandlerError('rate_limited', 'Easy on the buzzer!');

      const room = await hub.requireRoom(socket);
      // Arrival order decides: this mutation runs to completion before the next press is handled.
      const out = await hub.store.update(room.id, (r) => ({ r, res: game.pressBuzz(r, sessionId, Date.now()) }));
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) {
        // Losing a race is normal: answer quietly, never as an error.
        if (out.res.tooLate) return void ack?.({ ok: true, result: 'too_late' });
        throw new HandlerError('invalid_state', out.res.message);
      }
      const challenged = out.res.buzz.challengedSessionId ? out.r.participants.get(out.res.buzz.challengedSessionId) : undefined;
      const view = {
        participantId: out.r.participants.get(sessionId)!.id,
        username: out.res.buzz.username,
        at: out.res.buzz.at,
        challengedParticipantId: challenged?.id ?? null,
      };
      hub.io.to(room.id).emit('buzz:locked', view);
      for (const t of out.res.toasts) hub.toastRoom(room.id, t.type, t.message);
      ack?.({ ok: true, result: 'won' });
      await hub.changed(out.r);
    });

    hub.handle(socket, 'buzz:dismiss', async (p, ack) => {
      const room = await hub.requireHost(socket, p?.hostToken);
      const out = await hub.store.update(room.id, (r) => ({ r, res: game.dismissBuzz(r, Date.now()) }));
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) throw new HandlerError('invalid_state', out.res.message);
      onBuzzResolved(out.res.buzz, out.r, out.res.buzz.challengedSessionId);
      for (const t of out.res.toasts) hub.toastRoom(room.id, t.type, t.message);
      ack?.({ ok: true });
      await hub.changed(out.r);
    });
  });
}
