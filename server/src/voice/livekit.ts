import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config';
import type { Room } from '../domain/model';
import { canPublish } from '../domain/micPolicy';

// All server-side LiveKit calls live here so the rest of the server never imports the SDK directly.
export const roomService = new RoomServiceClient(config.livekitUrl, config.livekitApiKey, config.livekitApiSecret);

/** Best effort: the LiveKit room may never have been created if nobody joined voice. */
export async function deleteVoiceRoom(roomId: string): Promise<void> {
  try {
    await roomService.deleteRoom(roomId);
  } catch (err) {
    console.warn(`[livekit] deleteRoom(${roomId}) failed (ok if nobody joined voice):`, (err as Error).message);
  }
  appliedByRoom.delete(roomId);
}

export async function mintToken(roomId: string, identity: string, name: string, publish: boolean): Promise<string> {
  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, { identity, name, ttl: '1h' });
  at.addGrant({ roomJoin: true, room: roomId, canSubscribe: true, canPublish: publish, canPublishData: false });
  return at.toJwt();
}

/** Last permission we successfully applied per LiveKit identity, so we only send changes. */
const appliedByRoom = new Map<string, Map<string, boolean>>();
/** Serialize updates per room so an older call can't land after a newer one. */
const queueByRoom = new Map<string, Promise<void>>();

function isNotFound(err: unknown) {
  return /not.?found|does not exist/i.test((err as Error)?.message ?? '');
}

/**
 * Push the mic policy to LiveKit for every participant whose permission changed.
 * Participants who haven't joined voice yet fail with "not found"; that's expected: their
 * token is minted with the current policy and they re-sync via `voice:joined`.
 */
export function syncMicPermissions(room: Room, force: Set<string> = new Set()): Promise<void> {
  const desired = new Map<string, boolean>();
  for (const p of room.participants.values()) desired.set(p.id, canPublish(room, p));
  const applied = appliedByRoom.get(room.id) ?? new Map<string, boolean>();
  appliedByRoom.set(room.id, applied);

  const prev = queueByRoom.get(room.id) ?? Promise.resolve();
  const next = prev.then(async () => {
    for (const [identity, allow] of desired) {
      if (applied.get(identity) === allow && !force.has(identity)) continue;
      try {
        await roomService.updateParticipant(room.id, identity, {
          permission: { canPublish: allow, canSubscribe: true, canPublishData: false },
        });
        applied.set(identity, allow);
      } catch (err) {
        applied.delete(identity);
        if (!isNotFound(err)) console.warn(`[livekit] updateParticipant(${identity}) failed:`, (err as Error).message);
      }
    }
    for (const id of applied.keys()) if (!desired.has(id)) applied.delete(id);
  });
  queueByRoom.set(room.id, next.catch(() => {}));
  return next;
}
