import { nanoid } from 'nanoid';
import { normalizeUsername } from '@teeto/shared';
import { readJSON, writeJSON } from './storage';

const KEY = 'teeto.session';
const HOST_KEY = 'teeto.hostTokens';

export interface Session {
  sessionId: string;
  username: string | null;
}

let memo: Session | null = null;

/** Stable per-browser identity. Not a secret and not auth: see docs/IDENTITY.md. */
export function getSession(): Session {
  if (memo) return memo;
  const stored = readJSON<Partial<Session>>(KEY, {});
  memo = {
    sessionId: typeof stored.sessionId === 'string' && stored.sessionId.length >= 10 ? stored.sessionId : nanoid(),
    username: typeof stored.username === 'string' ? stored.username : null,
  };
  writeJSON(KEY, memo);
  return memo;
}

export function setUsername(name: string): Session {
  memo = { ...getSession(), username: normalizeUsername(name) };
  writeJSON(KEY, memo);
  return memo;
}

export function getHostToken(roomId: string): string | null {
  return readJSON<Record<string, string>>(HOST_KEY, {})[roomId] ?? null;
}

export function saveHostToken(roomId: string, token: string): void {
  writeJSON(HOST_KEY, { ...readJSON<Record<string, string>>(HOST_KEY, {}), [roomId]: token });
}

export function forgetHostToken(roomId: string): void {
  const all = readJSON<Record<string, string>>(HOST_KEY, {});
  delete all[roomId];
  writeJSON(HOST_KEY, all);
}
