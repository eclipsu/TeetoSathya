import { Router } from 'express';
import {
  LIMITS,
  isValidSessionId,
  normalizeUsername,
  validateRoomInput,
  validateUsername,
  type CreateRoomResponse,
  type RoomSummary,
} from '@teeto/shared';
import type { RoomStore } from '../store/RoomStore';
import { newRoom, summarize } from '../domain/rooms';
import { isHostToken } from '../domain/hostAuth';
import { sendError } from './errors';

export interface RoomsRouterDeps {
  store: RoomStore;
  /** Kick sockets, tear down voice, clear timers. Implemented by the socket layer. */
  closeRoom: (roomId: string, reason: string) => Promise<void>;
}

export function roomsRouter({ store, closeRoom }: RoomsRouterDeps): Router {
  const r = Router();

  r.get('/rooms', async (_req, res) => {
    const rooms: RoomSummary[] = (await store.list())
      .map(summarize)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ rooms });
  });

  r.post('/rooms', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (!isValidSessionId(body.hostSessionId)) return sendError(res, 400, 'bad_session', 'Invalid session id.');
    const nameErr = validateUsername(body.hostName);
    if (nameErr) return sendError(res, 400, 'bad_username', nameErr);

    const parsed = validateRoomInput(body);
    if (!parsed.ok) return sendError(res, 400, 'invalid_room', parsed.errors[0]!, parsed.errors);

    if ((await store.count()) >= LIMITS.maxRooms) {
      return sendError(res, 503, 'too_many_rooms', 'Room limit reached on this server. Delete an old room first.');
    }

    const room = newRoom(parsed.value, body.hostSessionId, Date.now());
    await store.create(room);
    console.log(`[rooms] created ${room.id} "${room.topic}" by ${normalizeUsername(body.hostName as string)}`);

    const out: CreateRoomResponse = { roomId: room.id, hostToken: room.hostToken };
    res.status(201).json(out);
  });

  r.delete('/rooms/:id', async (req, res) => {
    const room = await store.get(req.params.id);
    if (!room) return sendError(res, 404, 'not_found', 'Room not found.');
    if (!isHostToken(room, req.header('x-host-token'))) return sendError(res, 403, 'not_host', 'Only the host can delete this room.');
    await closeRoom(room.id, 'The host deleted this room.');
    res.status(204).end();
  });

  return r;
}
