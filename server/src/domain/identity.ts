import { LIMITS, normalizeUsername, usernameKey } from '@teeto/shared';
import type { Participant, Room } from './model';

export type ClaimResult =
  | { ok: true; participant: Participant; reclaimed: boolean; previousSocketId: string | null }
  | { ok: false; code: 'name_taken'; message: string; suggestions: string[] };

function findByName(room: Room, username: string): Participant | undefined {
  const key = usernameKey(username);
  for (const p of room.participants.values()) if (usernameKey(p.username) === key) return p;
  return undefined;
}

/**
 * Bind (sessionId, username) to a participant record in this room.
 * - Same sessionId: reclaim the record (seat, team, hot seat kept). Renaming is allowed if the new name is free.
 * - Name held by a different sessionId (connected or within grace): reject with suggestions.
 * Caller has already validated username format.
 */
export function claimIdentity(
  room: Room,
  sessionId: string,
  rawUsername: string,
  socketId: string,
  now: number,
  newId: () => string,
  rng: () => number = Math.random,
): ClaimResult {
  const username = normalizeUsername(rawUsername);
  const holder = findByName(room, username);
  if (holder && holder.sessionId !== sessionId) {
    return {
      ok: false,
      code: 'name_taken',
      message: `"${username}" is already taken in this room.`,
      suggestions: suggestNames(username, room, rng),
    };
  }

  const existing = room.participants.get(sessionId);
  if (existing) {
    const previousSocketId = existing.socketId;
    existing.username = username;
    existing.connected = true;
    existing.socketId = socketId;
    existing.disconnectedAt = null;
    return { ok: true, participant: existing, reclaimed: true, previousSocketId };
  }

  const participant: Participant = {
    id: newId(),
    sessionId,
    username,
    role: null,
    team: null,
    seatOrder: null,
    connected: true,
    socketId,
    joinedAt: now,
    disconnectedAt: null,
    timeUsedMs: 0,
  };
  room.participants.set(sessionId, participant);
  return { ok: true, participant, reclaimed: false, previousSocketId: null };
}

/** Three free, valid alternatives such as "sita2", "sita_7", "sita-41". */
export function suggestNames(username: string, room: Room, rng: () => number = Math.random): string[] {
  const taken = new Set([...room.participants.values()].map((p) => usernameKey(p.username)));
  const base = normalizeUsername(username).slice(0, LIMITS.usernameMax - 3);
  const out: string[] = [];
  const tryAdd = (candidate: string) => {
    const key = usernameKey(candidate);
    if (candidate.length <= LIMITS.usernameMax && !taken.has(key) && !out.some((o) => usernameKey(o) === key)) out.push(candidate);
  };
  for (let n = 2; n < 100 && out.length < 1; n++) tryAdd(`${base}${n}`);
  for (let i = 0; i < 50 && out.length < 2; i++) tryAdd(`${base}_${1 + Math.floor(rng() * 98)}`);
  for (let i = 0; i < 50 && out.length < 3; i++) tryAdd(`${base}-${1 + Math.floor(rng() * 98)}`);
  return out;
}

/** Mark disconnected only if this socket is still the participant's current one (a newer tab may have taken over). */
export function markDisconnected(room: Room, sessionId: string, socketId: string, now: number): Participant | null {
  const p = room.participants.get(sessionId);
  if (!p || p.socketId !== socketId) return null;
  p.connected = false;
  p.socketId = null;
  p.disconnectedAt = now;
  return p;
}

/** Remove the participant if they have been gone for the full grace period. Returns the removed record. */
export function releaseIfExpired(room: Room, sessionId: string, now: number, graceMs = LIMITS.reclaimGraceMs): Participant | null {
  const p = room.participants.get(sessionId);
  if (!p || p.connected || p.disconnectedAt === null || now - p.disconnectedAt < graceMs) return null;
  room.participants.delete(sessionId);
  return p;
}

export function connectedCount(room: Room): number {
  let n = 0;
  for (const p of room.participants.values()) if (p.connected) n++;
  return n;
}
