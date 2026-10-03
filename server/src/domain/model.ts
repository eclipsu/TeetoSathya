import type { Role, RoomSettings, RoomStatus, TeamIndex } from '@teeto/shared';

export interface Participant {
  /** Public per-room id: broadcast in snapshots and used as the LiveKit identity. */
  id: string;
  /** Private: lets the same browser reclaim this record. Never broadcast. */
  sessionId: string;
  username: string;
  /** null until the user picks a role in the room. */
  role: Role | null;
  team: TeamIndex | null;
  /** 1-based seat within the team for speakers; null for spectators / unseated. */
  seatOrder: number | null;
  connected: boolean;
  socketId: string | null;
  joinedAt: number;
  /** When the last socket dropped; seat + name are released after the grace period. */
  disconnectedAt: number | null;
  /** Talk time this speaker has used across the round (for summary + budget). */
  timeUsedMs: number;
}

export interface Buzz {
  sessionId: string;
  username: string;
  at: number;
  /** Hot-seat speaker who held the floor when the buzz landed (the one being challenged). */
  challengedSessionId: string | null;
}

export interface GameState {
  hotSeat: [string | null, string | null];
  activeSide: TeamIndex | null;
  /** ms remaining for each side's CURRENT hot-seat speaker, as of clockRunningSince (or frozen if not running). */
  clocks: [number, number];
  clockRunningSince: number | null;
  roundEndsAt: number | null;
  /** Frozen remaining round time while paused (roundEndsAt is recomputed on resume). */
  roundRemainingMs: number | null;
  paused: boolean;
  buzz: Buzz | null;
}

export interface Room {
  id: string;
  topic: string;
  sides: [string, string];
  hostSessionId: string;
  hostToken: string;
  status: RoomStatus;
  createdAt: number;
  lastActiveAt: number;
  participants: Map<string, Participant>;
  settings: RoomSettings;
  game: GameState;
  /** When the connected-participant count last dropped to zero; null while someone is connected. */
  emptySince: number | null;
}

export function initialGameState(turnSeconds: number): GameState {
  return {
    hotSeat: [null, null],
    activeSide: null,
    clocks: [turnSeconds * 1000, turnSeconds * 1000],
    clockRunningSince: null,
    roundEndsAt: null,
    roundRemainingMs: null,
    paused: false,
    buzz: null,
  };
}
