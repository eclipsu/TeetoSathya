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
