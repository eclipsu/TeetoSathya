import { newRoom } from '../domain/rooms';
import type { Room } from '../domain/model';
import { claimIdentity } from '../domain/identity';

export function makeRoom(): Room {
  return newRoom({ topic: 'T', sides: ['A', 'B'], turnSeconds: 60, roundSeconds: 600 }, 'host-session-0001', 1_000);
}

let n = 0;
export function join(room: Room, sessionId: string, name: string, now = 1_000) {
  const r = claimIdentity(room, sessionId, name, `sock-${sessionId}-${n++}`, now, () => `pid-${sessionId}`);
  if (!r.ok) throw new Error(r.message);
  return r.participant;
}
