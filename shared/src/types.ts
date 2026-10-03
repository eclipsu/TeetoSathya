export type TeamIndex = 0 | 1;
export type RoomStatus = 'lobby' | 'live' | 'ended';
export type Role = 'speaker' | 'spectator';

export interface RoomSettings {
  speakersPerTeamMax: number;
  /** Talk-time budget per speaker, set by the host. */
  turnSeconds: number;
  /** Total round length, set by the host. */
  roundSeconds: number;
}

/** Row in GET /api/rooms. */
export interface RoomSummary {
  id: string;
  topic: string;
  sides: [string, string];
  speakerCounts: [number, number];
  spectatorCount: number;
  status: RoomStatus;
  settings: RoomSettings;
  createdAt: number;
}

export interface CreateRoomBody {
  topic: string;
  sides: [string, string];
  hostSessionId: string;
  hostName: string;
  turnSeconds?: number;
  roundSeconds?: number;
}

export interface CreateRoomResponse {
  roomId: string;
  hostToken: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: string[] };
}

/**
 * Public view of a participant. `id` is a public per-room id, NOT the sessionId:
 * the sessionId is what lets a browser reclaim a seat, so it is never broadcast.
 */
export interface ParticipantView {
  id: string;
  username: string;
  role: Role | null;
  team: TeamIndex | null;
  seatOrder: number | null;
  connected: boolean;
  isHost: boolean;
  /** Talk time used this round, ms (excludes the currently running stint). */
  timeUsedMs: number;
}

export interface BuzzView {
  participantId: string;
  username: string;
  at: number;
  /** Hot-seat speaker who held the floor when the buzz landed. */
  challengedParticipantId: string | null;
}

export interface GameView {
  /** Participant ids in the hot seat per team. */
  hotSeat: [string | null, string | null];
  activeSide: TeamIndex | null;
  /** ms remaining per side as of `clockRunningSince` (or frozen when that is null). */
  clocks: [number, number];
  /** Server epoch ms when the active side's clock started running; null when stopped. */
  clockRunningSince: number | null;
  roundEndsAt: number | null;
  roundRemainingMs: number | null;
  paused: boolean;
  buzz: BuzzView | null;
}

export interface RoomSnapshot {
  id: string;
  topic: string;
  sides: [string, string];
  status: RoomStatus;
  settings: RoomSettings;
  participants: ParticipantView[];
  game: GameView;
  /** Server clock at send time; clients also keep a measured offset. */
  serverNow: number;
}
