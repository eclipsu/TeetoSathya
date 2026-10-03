import { LIMITS } from './limits';

const USERNAME_RE = /^[A-Za-z0-9 _-]+$/;
const SESSION_RE = /^[A-Za-z0-9_-]{10,64}$/;

/** Trim and collapse inner whitespace so "Ram   Bahadur" and "Ram Bahadur" are the same name. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Case-insensitive key used for name reservation. */
export function usernameKey(name: string): string {
  return normalizeUsername(name).toLowerCase();
}

export function validateUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Username is required.';
  const name = normalizeUsername(raw);
  if (name.length < LIMITS.usernameMin) return `Use at least ${LIMITS.usernameMin} characters.`;
  if (name.length > LIMITS.usernameMax) return `Use at most ${LIMITS.usernameMax} characters.`;
  if (!USERNAME_RE.test(name)) return 'Only letters, numbers, spaces, _ and - are allowed.';
  return null;
}

export function isValidSessionId(raw: unknown): raw is string {
  return typeof raw === 'string' && SESSION_RE.test(raw);
}

export interface RoomInput {
  topic: string;
  sides: [string, string];
  turnSeconds: number;
  roundSeconds: number;
}

/** Validates and normalizes room creation input. Returns either the clean value or a list of errors. */
export function validateRoomInput(raw: {
  topic?: unknown;
  sides?: unknown;
  turnSeconds?: unknown;
  roundSeconds?: unknown;
}): { ok: true; value: RoomInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const topic = typeof raw.topic === 'string' ? raw.topic.trim().replace(/\s+/g, ' ') : '';
  if (!topic) errors.push('Topic is required.');
  else if (topic.length > LIMITS.topicMax) errors.push(`Topic must be at most ${LIMITS.topicMax} characters.`);

  let sides: [string, string] = ['', ''];
  if (!Array.isArray(raw.sides) || raw.sides.length !== 2) {
    errors.push('Exactly two side labels are required.');
  } else {
    sides = raw.sides.map((s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '')) as [string, string];
    if (!sides[0] || !sides[1]) errors.push('Both side labels are required.');
    if (sides.some((s) => s.length > LIMITS.sideMax)) errors.push(`Side labels must be at most ${LIMITS.sideMax} characters.`);
    if (sides[0] && sides[0].toLowerCase() === sides[1].toLowerCase()) errors.push('Side labels must be different.');
  }

  const turnSeconds = raw.turnSeconds === undefined ? LIMITS.turnSecondsDefault : raw.turnSeconds;
  if (!Number.isInteger(turnSeconds) || (turnSeconds as number) < LIMITS.turnSecondsMin || (turnSeconds as number) > LIMITS.turnSecondsMax) {
    errors.push(`Time per speaker must be ${LIMITS.turnSecondsMin}-${LIMITS.turnSecondsMax} seconds.`);
  }
  const roundSeconds = raw.roundSeconds === undefined ? LIMITS.roundSecondsDefault : raw.roundSeconds;
  if (!Number.isInteger(roundSeconds) || (roundSeconds as number) < LIMITS.roundSecondsMin || (roundSeconds as number) > LIMITS.roundSecondsMax) {
    errors.push(`Round length must be ${LIMITS.roundSecondsMin}-${LIMITS.roundSecondsMax} seconds.`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { topic, sides, turnSeconds: turnSeconds as number, roundSeconds: roundSeconds as number } };
}
