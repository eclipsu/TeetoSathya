import { timingSafeEqual } from 'node:crypto';
import type { Room } from './model';

/** Constant-time host token check. */
export function isHostToken(room: Room, token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(room.hostToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
