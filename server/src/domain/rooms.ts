import { customAlphabet, nanoid } from 'nanoid';
import { LIMITS, type RoomInput, type RoomSummary } from '@teeto/shared';
import { initialGameState, type Room } from './model';

// Short, unambiguous room ids (no 0/O/1/l/I) that are easy to read out loud.
const roomId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 8);

export function newRoom(input: RoomInput, hostSessionId: string, now: number): Room {
  return {
    id: roomId(),
    topic: input.topic,
    sides: input.sides,
    hostSessionId,
    hostToken: nanoid(32),
    status: 'lobby',
    createdAt: now,
    lastActiveAt: now,
    participants: new Map(),
    settings: {
      speakersPerTeamMax: LIMITS.speakersPerTeamMax,
      turnSeconds: input.turnSeconds,
      roundSeconds: input.roundSeconds,
    },
    game: initialGameState(input.turnSeconds),
    emptySince: now,
  };
}

export function summarize(room: Room): RoomSummary {
  const speakerCounts: [number, number] = [0, 0];
  let spectatorCount = 0;
  for (const p of room.participants.values()) {
    if (p.role === 'speaker' && p.team !== null) speakerCounts[p.team]++;
    else if (p.role === 'spectator') spectatorCount++;
  }
  return {
    id: room.id,
    topic: room.topic,
    sides: room.sides,
    speakerCounts,
    spectatorCount,
    status: room.status,
    settings: room.settings,
    createdAt: room.createdAt,
  };
}
