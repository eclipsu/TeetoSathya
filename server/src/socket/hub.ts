import type { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import {
  LIMITS,
  isValidSessionId,
  validateUsername,
  type Ack,
  type AppError,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type ToastType,
} from '@teeto/shared';
import type { RoomStore } from '../store/RoomStore';
import type { Room } from '../domain/model';
import { claimIdentity, connectedCount, markDisconnected, releaseIfExpired } from '../domain/identity';
import { setRole } from '../domain/seats';
import { toSnapshot } from '../domain/snapshot';
import { isHostToken } from '../domain/hostAuth';
import { TokenBucket } from './rateLimit';

export interface SocketData {
  sessionId: string;
  roomId?: string;
  limiter: TokenBucket;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Error thrown inside handlers; converted to an ack failure for the client. */
export class HandlerError extends Error {
  constructor(public code: AppError['code'], message: string, public suggestions?: string[]) {
    super(message);
  }
}

/** Hooks other modules (voice policy, game timers) attach to run after every room change. */
export type RoomChangeHook = (room: Room) => void | Promise<void>;
export type RoomClosedHook = (roomId: string) => void | Promise<void>;

const SWEEP_MS = 30_000;

export class RoomHub {
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private changeHooks: RoomChangeHook[] = [];
  private closedHooks: RoomClosedHook[] = [];

  constructor(public readonly io: IO, public readonly store: RoomStore) {}

  onRoomChange(hook: RoomChangeHook) {
    this.changeHooks.push(hook);
  }
  onRoomClosed(hook: RoomClosedHook) {
    this.closedHooks.push(hook);
  }
  private voiceJoinedHooks: ((room: Room, participantId: string) => void)[] = [];
  onVoiceJoined(hook: (room: Room, participantId: string) => void) {
    this.voiceJoinedHooks.push(hook);
  }

  start() {
    // Handshake: every socket must carry a well-formed sessionId.
    this.io.use((socket, next) => {
      const sessionId = (socket.handshake.auth as { sessionId?: unknown })?.sessionId;
      if (!isValidSessionId(sessionId)) return next(new Error('bad_session'));
      socket.data.sessionId = sessionId;
      socket.data.limiter = new TokenBucket(20, 10);
      next();
    });
    this.io.on('connection', (s) => this.bind(s));
    setInterval(() => void this.sweepIdleRooms(), SWEEP_MS).unref();
  }

  /** Register a handler with rate limiting and uniform error -> ack mapping. */
  handle<E extends keyof ClientToServerEvents>(
    socket: AppSocket,
    event: E,
    fn: (...args: Parameters<ClientToServerEvents[E]>) => Promise<void> | void,
  ) {
    socket.on(event, (async (...args: unknown[]) => {
      const ack = args.find((a) => typeof a === 'function') as Ack<any> | undefined;
      if (!socket.data.limiter.take()) {
        ack?.({ ok: false, code: 'rate_limited', message: 'Slow down a little.' });
        return;
      }
      try {
        await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (err) {
        if (err instanceof HandlerError) {
          ack?.({ ok: false, code: err.code, message: err.message, ...(err.suggestions ? { suggestions: err.suggestions } : {}) });
        } else {
          console.error(`[socket] ${String(event)} failed`, err);
          ack?.({ ok: false, code: 'bad_request', message: 'Something went wrong on the server.' });
        }
      }
    }) as never);
  }

  /** Load the room the socket is in, or throw not_joined. */
  async requireRoom(socket: AppSocket): Promise<Room> {
    const roomId = socket.data.roomId;
    const room = roomId ? await this.store.get(roomId) : undefined;
    if (!room || !room.participants.has(socket.data.sessionId)) throw new HandlerError('not_joined', 'You are not in a room.');
    return room;
  }

  /** Verify a host-only request: right session AND right token. */
  async requireHost(socket: AppSocket, hostToken: unknown): Promise<Room> {
    const room = await this.requireRoom(socket);
    if (room.hostSessionId !== socket.data.sessionId || !isHostToken(room, hostToken)) {
      throw new HandlerError('not_host', 'Only the host can do that.');
    }
    return room;
  }

  /** Broadcast the new snapshot and run change hooks (voice permissions, game timers). */
  async changed(room: Room) {
    room.lastActiveAt = Date.now();
    this.io.to(room.id).emit('room:state', toSnapshot(room, Date.now()));
    for (const hook of this.changeHooks) {
      try {
        await hook(room);
      } catch (err) {
        console.error('[hub] change hook failed', err);
      }
    }
  }

  toastRoom(roomId: string, type: ToastType, message: string, exceptSocketId?: string) {
    const target = exceptSocketId ? this.io.to(roomId).except(exceptSocketId) : this.io.to(roomId);
    target.emit('toast', { type, message });
  }

  private bind(socket: AppSocket) {
    this.handle(socket, 'time:ping', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    this.handle(socket, 'room:join', async (p, ack) => {
      if (typeof ack !== 'function') return;
      if (!p || typeof p.roomId !== 'string') throw new HandlerError('bad_request', 'Missing room id.');
      if (p.sessionId !== socket.data.sessionId) throw new HandlerError('bad_session', 'Session mismatch. Reload the page.');
      const nameErr = validateUsername(p.username);
      if (nameErr) throw new HandlerError('bad_username', nameErr);

      // One room per socket: leaving any previous room first.
      if (socket.data.roomId && socket.data.roomId !== p.roomId) await this.detach(socket, 'switch');

      const now = Date.now();
      const result = await this.store.update(p.roomId, (room) => {
        const claim = claimIdentity(room, socket.data.sessionId, p.username, socket.id, now, () => nanoid(10));
        if (claim.ok) room.emptySince = null;
        return { claim, room };
      });
      if (!result) throw new HandlerError('room_not_found', 'This room no longer exists.');
      const { claim, room } = result;
      if (!claim.ok) throw new HandlerError('name_taken', claim.message, claim.suggestions);

      this.clearGrace(room.id, socket.data.sessionId);

      // Same session opened in another tab: the newest tab wins.
      if (claim.previousSocketId && claim.previousSocketId !== socket.id) {
        const old = this.io.sockets.sockets.get(claim.previousSocketId) as AppSocket | undefined;
        if (old) {
          old.emit('error', { code: 'session_replaced', message: 'You opened this room in another tab or device.' });
          old.leave(room.id);
          old.data.roomId = undefined;
        }
      }

      await socket.join(room.id);
      socket.data.roomId = room.id;
      const isHost = room.hostSessionId === socket.data.sessionId && isHostToken(room, p.hostToken);

      ack({ ok: true, you: claim.participant.id, isHost, reclaimed: claim.reclaimed, snapshot: toSnapshot(room, Date.now()) });
      if (!claim.reclaimed) this.toastRoom(room.id, 'info', `${claim.participant.username} joined`, socket.id);
      await this.changed(room);
    });

    this.handle(socket, 'role:set', async (p, ack) => {
      const { id } = await this.requireRoom(socket);
      const out = await this.store.update(id, (room) => {
        const res = setRole(room, socket.data.sessionId, p?.role, p?.team);
        if (res.ok && res.changed && res.vacatedHotSeat !== null) this.hotSeatVacated(room, res.vacatedHotSeat);
        return { res, room };
      });
      if (!out) throw new HandlerError('room_not_found', 'This room no longer exists.');
      if (!out.res.ok) throw new HandlerError(out.res.code, out.res.message);
      ack?.({ ok: true });
      if (out.res.changed) await this.changed(out.room);
    });

    // Client finished connecting to LiveKit: re-apply its mic permission in case policy
    // changed between minting the token and the LiveKit connection completing.
    this.handle(socket, 'voice:joined', async (ack) => {
      const room = await this.requireRoom(socket);
      const p = room.participants.get(socket.data.sessionId)!;
      for (const hook of this.voiceJoinedHooks) hook(room, p.id);
      ack?.({ ok: true });
    });

    this.handle(socket, 'room:leave', async (ack) => {
      await this.detach(socket, 'leave');
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => void this.detach(socket, 'disconnect'));
  }

  /** Game module overrides this to refill a hot seat (checkpoint E). */
  hotSeatVacated: (room: Room, side: 0 | 1) => void = () => {};

  /**
   * Socket stops being in its room.
   * 'leave' removes the participant now; 'disconnect'/'switch' start the reclaim grace period.
   */
  private async detach(socket: AppSocket, why: 'leave' | 'disconnect' | 'switch') {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.data.roomId = undefined;
    socket.leave(roomId);
    const sessionId = socket.data.sessionId;
    const now = Date.now();

    const room = await this.store.update(roomId, (room) => {
      const p = room.participants.get(sessionId);
      if (!p || p.socketId !== socket.id) return null; // a newer tab owns this record
      if (why === 'leave') {
        room.participants.delete(sessionId);
        const vacated = room.game.hotSeat.indexOf(sessionId);
        if (vacated !== -1) {
          room.game.hotSeat[vacated] = null;
          this.hotSeatVacated(room, vacated as 0 | 1);
        }
        this.toastRoom(roomId, 'info', `${p.username} left`);
      } else {
        markDisconnected(room, sessionId, socket.id, now);
      }
      if (connectedCount(room) === 0) room.emptySince = now;
      return room;
    });
    if (!room) return;
    if (why !== 'leave') this.scheduleGrace(roomId, sessionId);
    await this.changed(room);
  }

  private graceKey(roomId: string, sessionId: string) {
    return `${roomId}:${sessionId}`;
  }

  private clearGrace(roomId: string, sessionId: string) {
    const key = this.graceKey(roomId, sessionId);
    clearTimeout(this.graceTimers.get(key));
    this.graceTimers.delete(key);
  }

  private scheduleGrace(roomId: string, sessionId: string) {
    this.clearGrace(roomId, sessionId);
    const key = this.graceKey(roomId, sessionId);
    this.graceTimers.set(
      key,
      setTimeout(async () => {
        this.graceTimers.delete(key);
        const room = await this.store.update(roomId, (room) => {
          const wasHot = room.game.hotSeat.indexOf(sessionId);
          const removed = releaseIfExpired(room, sessionId, Date.now());
          if (!removed) return null;
          if (wasHot !== -1) {
            room.game.hotSeat[wasHot] = null;
            this.hotSeatVacated(room, wasHot as 0 | 1);
          }
          this.toastRoom(roomId, 'info', `${removed.username} left (connection lost)`);
          return room;
        });
        if (room) await this.changed(room);
      }, LIMITS.reclaimGraceMs + 50),
    );
  }

  private async sweepIdleRooms() {
    const now = Date.now();
    for (const room of await this.store.list()) {
      if (connectedCount(room) === 0 && room.emptySince !== null && now - room.emptySince >= LIMITS.idleRoomMs) {
        await this.closeRoom(room.id, 'Closed after 5 minutes with nobody connected.');
      }
    }
  }

  /** Kick everyone, clear timers, delete state. Voice teardown runs via onRoomClosed hooks. */
  async closeRoom(roomId: string, reason: string) {
    this.io.to(roomId).emit('room:closed', { reason });
    for (const s of await this.io.in(roomId).fetchSockets()) {
      const live = this.io.sockets.sockets.get(s.id) as AppSocket | undefined;
      if (live) live.data.roomId = undefined;
    }
    this.io.in(roomId).socketsLeave(roomId);
    for (const key of [...this.graceTimers.keys()]) if (key.startsWith(roomId + ':')) this.clearGrace(roomId, key.slice(roomId.length + 1));
    await this.store.delete(roomId);
    for (const hook of this.closedHooks) {
      try {
        await hook(roomId);
      } catch (err) {
        console.error('[hub] close hook failed', err);
      }
    }
    console.log(`[rooms] closed ${roomId}: ${reason}`);
  }
}
