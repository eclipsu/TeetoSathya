import { describe, expect, it } from 'vitest';
import * as game from '../domain/game';
import { setRole } from '../domain/seats';
import { join, makeRoom } from './helpers';
import type { Room } from '../domain/model';

const T0 = 1_000_000;
const TURN = 60_000; // makeRoom: 60s per speaker, 600s round

/** Host + A2 on team A, B1 + B2 on team B, one spectator. */
function liveRoom(): Room {
  const room = makeRoom();
  join(room, room.hostSessionId, 'Host');
  setRole(room, room.hostSessionId, 'speaker', 0);
  for (const [sid, name, team] of [['sess-a2-00001', 'A2', 0], ['sess-b1-00001', 'B1', 1], ['sess-b2-00001', 'B2', 1]] as const) {
    join(room, sid, name);
    setRole(room, sid, 'speaker', team);
  }
  join(room, 'sess-spec-0001', 'Spec');
  setRole(room, 'sess-spec-0001', 'spectator', null);
  join(room, 'sess-spec-0002', 'Spec2');
  setRole(room, 'sess-spec-0002', 'spectator', null);
  const r = game.startRound(room, T0);
  if (!r.ok) throw new Error(r.message);
  return room;
}

describe('start round', () => {
  it('needs a speaker on each team', () => {
    const room = makeRoom();
    join(room, room.hostSessionId, 'Host');
    setRole(room, room.hostSessionId, 'speaker', 0);
    expect(game.startRound(room, T0).ok).toBe(false);
  });
  it('seats lowest seatOrder per team, team A opens, round deadline set', () => {
    const room = liveRoom();
    expect(room.game.hotSeat).toEqual([room.hostSessionId, 'sess-b1-00001']);
    expect(room.game.activeSide).toBe(0);
    expect(room.game.roundEndsAt).toBe(T0 + 600_000);
    expect(game.nextDeadline(room)).toBe(T0 + TURN);
  });
});

describe('chess-clock math', () => {
  it('only the active side counts down; time carries over between turns', () => {
    const room = liveRoom();
    expect(game.turnDone(room, room.hostSessionId, T0 + 20_000).ok).toBe(true);
    expect(room.game.activeSide).toBe(1);
    expect(game.clockRemaining(room, 0, T0 + 50_000)).toBe(40_000); // A frozen at 40s
    expect(game.clockRemaining(room, 1, T0 + 50_000)).toBe(30_000); // B ran 30s
    game.turnDone(room, 'sess-b1-00001', T0 + 50_000);
    expect(game.clockRemaining(room, 0, T0 + 55_000)).toBe(35_000);
    expect(room.participants.get(room.hostSessionId)!.timeUsedMs).toBe(20_000);
  });

  it('only the active hot-seat speaker can say "done"', () => {
    const room = liveRoom();
    expect(game.turnDone(room, 'sess-b1-00001', T0 + 1000).ok).toBe(false);
    expect(game.turnDone(room, 'sess-a2-00001', T0 + 1000).ok).toBe(false);
  });

  it('pause freezes both clocks and the round clock; resume shifts the round deadline', () => {
    const room = liveRoom();
    game.pause(room, T0 + 10_000);
    expect(game.clockRemaining(room, 0, T0 + 99_000)).toBe(50_000);
    expect(room.game.roundRemainingMs).toBe(590_000);
    expect(game.nextDeadline(room)).toBeNull();
    game.resume(room, T0 + 100_000);
    expect(room.game.roundEndsAt).toBe(T0 + 100_000 + 590_000);
    expect(game.nextDeadline(room)).toBe(T0 + 100_000 + 50_000);
  });

  it('clock expiry: speaker replaced by next teammate, floor switches', () => {
    const room = liveRoom();
    expect(game.tick(room, T0 + TURN - 1).ok && room.game.activeSide).toBe(0); // not yet
    game.tick(room, T0 + TURN);
    expect(room.game.hotSeat[0]).toBe('sess-a2-00001'); // host exhausted -> A2
    expect(room.game.clocks[0]).toBe(TURN); // fresh budget for the new speaker
    expect(room.game.activeSide).toBe(1);
    expect(room.participants.get(room.hostSessionId)!.timeUsedMs).toBe(TURN);
  });

  it('rotate speaker keeps per-speaker budgets', () => {
    const room = liveRoom();
    game.rotateSpeaker(room, 0, T0 + 15_000); // host used 15s, A2 comes in
    expect(room.game.hotSeat[0]).toBe('sess-a2-00001');
    expect(game.clockRemaining(room, 0, T0 + 15_000)).toBe(TURN);
    game.rotateSpeaker(room, 0, T0 + 25_000); // A2 used 10s, host returns with 45s left
    expect(game.clockRemaining(room, 0, T0 + 25_000)).toBe(45_000);
  });

  it('round ends when the round deadline passes, even with talk time left', () => {
    const room = liveRoom();
    room.settings.totalRounds = 1; // single-round game: the round ending ends the game
    room.game.roundEndsAt = T0 + 30_000; // shorter than any speaker's budget
    expect(game.nextDeadline(room)).toBe(T0 + 30_000);
    game.tick(room, T0 + 29_999);
    expect(room.status).toBe('live');
    game.tick(room, T0 + 30_000);
    expect(room.status).toBe('ended');
    expect(room.participants.get(room.hostSessionId)!.timeUsedMs).toBe(30_000);
    expect(game.nextDeadline(room)).toBeNull();
  });

  it('round ends when everyone is out of time', () => {
    const room = liveRoom();
    room.settings.totalRounds = 1; // single-round game: the round ending ends the game
    let t = T0;
    for (let i = 0; i < 4; i++) {
      t = game.nextDeadline(room)!;
      game.tick(room, t);
    }
    expect(room.status).toBe('ended');
    expect(t).toBe(T0 + 4 * TURN);
  });
});

describe('buzzer', () => {
  it('first valid press wins; later presses are "too late"', () => {
    const room = liveRoom();
    const first = game.pressBuzz(room, 'sess-spec-0002', T0 + 5000);
    const second = game.pressBuzz(room, 'sess-spec-0001', T0 + 5000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.tooLate).toBe(true);
    expect(room.game.buzz?.sessionId).toBe('sess-spec-0002');
  });

  it('speakers (benched or hot seat) cannot buzz; only while live and unpaused', () => {
    const room = liveRoom();
    expect(game.pressBuzz(room, room.hostSessionId, T0).ok).toBe(false);
    expect(game.pressBuzz(room, 'sess-a2-00001', T0).ok).toBe(false);
    game.pause(room, T0 + 1);
    const paused = game.pressBuzz(room, 'sess-spec-0001', T0 + 2);
    expect(paused.ok || paused.tooLate).toBe(false);
  });

  it('buzz pauses both clocks, switches the floor, and records who was challenged', () => {
    const room = liveRoom();
    const r = game.pressBuzz(room, 'sess-spec-0001', T0 + 12_000);
    expect(r.ok && r.buzz.challengedSessionId).toBe(room.hostSessionId);
    expect(room.game.paused).toBe(true);
    expect(room.game.activeSide).toBe(1);
    expect(game.clockRemaining(room, 0, T0 + 99_000)).toBe(48_000);
    expect(game.resume(room, T0 + 20_000).ok).toBe(false); // must dismiss first
    expect(game.dismissBuzz(room, T0 + 20_000).ok).toBe(true);
    expect(room.game.paused).toBe(false);
    expect(game.clockRemaining(room, 1, T0 + 30_000)).toBe(50_000);
  });
});

describe('hot seat vacated while live', () => {
  it('next teammate fills in; if the team is empty and held the floor, the floor switches', () => {
    const room = liveRoom();
    setRole(room, room.hostSessionId, 'speaker', 1); // host switches teams (B now has 3)
    game.hotSeatVacated(room, 0, T0 + 1000);
    expect(room.game.hotSeat[0]).toBe('sess-a2-00001');
    setRole(room, 'sess-a2-00001', 'spectator', null);
    game.hotSeatVacated(room, 0, T0 + 2000);
    expect(room.game.hotSeat[0]).toBeNull();
    expect(room.game.activeSide).toBe(1);
  });
});
