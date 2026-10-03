import { describe, expect, it } from 'vitest';
import { claimIdentity, markDisconnected, releaseIfExpired, suggestNames } from '../domain/identity';
import { LIMITS, validateUsername } from '@teeto/shared';
import { join, makeRoom } from './helpers';

describe('username uniqueness', () => {
  it('rejects a taken name from a different session, case-insensitively and ignoring extra spaces', () => {
    const room = makeRoom();
    join(room, 'session-aaaa1', 'Sita Ram');
    const r = claimIdentity(room, 'session-bbbb2', '  sita   RAM ', 'sock-x', 1_000, () => 'pid-x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('name_taken');
  });

  it('offers 3 distinct, valid, free suggestions', () => {
    const room = makeRoom();
    join(room, 'session-aaaa1', 'sita');
    join(room, 'session-aaaa2', 'sita2'); // first obvious pick already taken
    const s = suggestNames('sita', room, () => 0.5);
    expect(s).toHaveLength(3);
    expect(new Set(s.map((x) => x.toLowerCase())).size).toBe(3);
    for (const name of s) {
      expect(validateUsername(name)).toBeNull();
      expect(name.toLowerCase()).not.toBe('sita2');
    }
  });

  it('keeps suggestions within the max length for long names', () => {
    const room = makeRoom();
    const long = 'x'.repeat(LIMITS.usernameMax);
    join(room, 'session-aaaa1', long);
    for (const name of suggestNames(long, room)) expect(name.length).toBeLessThanOrEqual(LIMITS.usernameMax);
  });
});

describe('reclaim', () => {
  it('same session gets the same record (id, team, seat) back', () => {
    const room = makeRoom();
    const p = join(room, 'session-aaaa1', 'Ram');
    p.role = 'speaker';
    p.team = 1;
    p.seatOrder = 2;
    markDisconnected(room, 'session-aaaa1', p.socketId!, 2_000);
    const r = claimIdentity(room, 'session-aaaa1', 'Ram', 'sock-new', 3_000, () => 'should-not-be-used');
    expect(r.ok && r.reclaimed).toBe(true);
    if (r.ok) {
      expect(r.participant.id).toBe(p.id);
      expect(r.participant.team).toBe(1);
      expect(r.participant.seatOrder).toBe(2);
      expect(r.participant.connected).toBe(true);
    }
  });

  it('holds the name during the grace period, then releases it', () => {
    const room = makeRoom();
    const p = join(room, 'session-aaaa1', 'Ram');
    markDisconnected(room, 'session-aaaa1', p.socketId!, 10_000);

    expect(claimIdentity(room, 'session-bbbb2', 'ram', 's', 10_000 + LIMITS.reclaimGraceMs - 1, () => 'x').ok).toBe(false);
    expect(releaseIfExpired(room, 'session-aaaa1', 10_000 + LIMITS.reclaimGraceMs - 1)).toBeNull();
    expect(releaseIfExpired(room, 'session-aaaa1', 10_000 + LIMITS.reclaimGraceMs)).not.toBeNull();
    expect(claimIdentity(room, 'session-bbbb2', 'ram', 's', 10_000 + LIMITS.reclaimGraceMs, () => 'x').ok).toBe(true);
  });

  it('a stale socket disconnecting does not kick the newer tab', () => {
    const room = makeRoom();
    const p = join(room, 'session-aaaa1', 'Ram');
    const oldSocket = p.socketId!;
    claimIdentity(room, 'session-aaaa1', 'Ram', 'sock-newer', 2_000, () => 'x');
    expect(markDisconnected(room, 'session-aaaa1', oldSocket, 3_000)).toBeNull();
    expect(room.participants.get('session-aaaa1')!.connected).toBe(true);
  });
});
