import { describe, expect, it } from 'vitest';
import { setRole } from '../domain/seats';
import { join, makeRoom } from './helpers';

describe('seat limits', () => {
  it('allows 4 speakers per team, rejects the 5th, unlimited spectators', () => {
    const room = makeRoom();
    for (let i = 1; i <= 5; i++) join(room, `session-sp${i}000`, `Sp${i}`);
    for (let i = 1; i <= 4; i++) expect(setRole(room, `session-sp${i}000`, 'speaker', 0).ok).toBe(true);
    const fifth = setRole(room, 'session-sp5000', 'speaker', 0);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.code).toBe('team_full');

    for (let i = 1; i <= 30; i++) {
      join(room, `session-wa${i}000`, `Watcher${i}`);
      expect(setRole(room, `session-wa${i}000`, 'spectator', null).ok).toBe(true);
    }
  });

  it('two back-to-back requests for the last seat: exactly one wins', () => {
    const room = makeRoom();
    for (let i = 1; i <= 5; i++) join(room, `session-sp${i}000`, `Sp${i}`);
    for (let i = 1; i <= 3; i++) setRole(room, `session-sp${i}000`, 'speaker', 1);
    const a = setRole(room, 'session-sp4000', 'speaker', 1);
    const b = setRole(room, 'session-sp5000', 'speaker', 1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it('assigns the lowest free seat and never duplicates seats', () => {
    const room = makeRoom();
    for (let i = 1; i <= 4; i++) join(room, `session-sp${i}000`, `Sp${i}`);
    for (let i = 1; i <= 3; i++) setRole(room, `session-sp${i}000`, 'speaker', 0);
    setRole(room, 'session-sp2000', 'spectator', null); // frees seat 2
    setRole(room, 'session-sp4000', 'speaker', 0);
    expect(room.participants.get('session-sp4000')!.seatOrder).toBe(2);
    const seats = [...room.participants.values()].filter((p) => p.team === 0).map((p) => p.seatOrder);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it('switching teams moves the seat; switching to the same team is a no-op', () => {
    const room = makeRoom();
    join(room, 'session-sp1000', 'Sp1');
    setRole(room, 'session-sp1000', 'speaker', 0);
    const same = setRole(room, 'session-sp1000', 'speaker', 0);
    expect(same.ok && !same.changed).toBe(true);
    setRole(room, 'session-sp1000', 'speaker', 1);
    const p = room.participants.get('session-sp1000')!;
    expect([p.team, p.seatOrder]).toEqual([1, 1]);
  });

  it('host must be a speaker', () => {
    const room = makeRoom();
    join(room, room.hostSessionId, 'Host');
    const r = setRole(room, room.hostSessionId, 'spectator', null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('host_must_speak');
  });

  it('leaving the team vacates the hot seat', () => {
    const room = makeRoom();
    join(room, 'session-sp1000', 'Sp1');
    setRole(room, 'session-sp1000', 'speaker', 0);
    room.game.hotSeat[0] = 'session-sp1000';
    const r = setRole(room, 'session-sp1000', 'spectator', null);
    expect(r.ok && r.vacatedHotSeat).toBe(0);
    expect(room.game.hotSeat[0]).toBeNull();
  });

  it('rejects malformed input', () => {
    const room = makeRoom();
    join(room, 'session-sp1000', 'Sp1');
    expect(setRole(room, 'session-sp1000', 'speaker', 2 as never).ok).toBe(false);
    expect(setRole(room, 'session-sp1000', 'judge' as never, 0).ok).toBe(false);
    expect(setRole(room, 'nobody-session', 'speaker', 0).ok).toBe(false);
  });
});
