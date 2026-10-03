import { Router } from 'express';
import { isValidSessionId } from '@teeto/shared';
import type { RoomStore } from '../store/RoomStore';
import { canPublish } from '../domain/micPolicy';
import { mintToken } from '../voice/livekit';
import { sendError } from './errors';

export function livekitRouter(store: RoomStore): Router {
  const r = Router();

  r.post('/rooms/:id/livekit-token', async (req, res) => {
    const sessionId = (req.body as { sessionId?: unknown } | undefined)?.sessionId;
    if (!isValidSessionId(sessionId)) return sendError(res, 400, 'bad_session', 'Invalid session id.');
    const room = await store.get(req.params.id);
    if (!room) return sendError(res, 404, 'not_found', 'Room not found.');
    const p = room.participants.get(sessionId);
    if (!p) return sendError(res, 403, 'not_joined', 'Join the room before joining voice.');

    const publish = canPublish(room, p);
    // Identity is the PUBLIC participant id: other LiveKit clients can see identities.
    const token = await mintToken(room.id, p.id, p.username, publish);
    res.json({ token, identity: p.id, canPublish: publish });
  });

  return r;
}
