import type { BuzzView, Role, RoomSnapshot, TeamIndex } from './types';

export type ToastType = 'info' | 'success' | 'warn' | 'error';

export type ErrorCode =
  | 'bad_request'
  | 'bad_session'
  | 'bad_username'
  | 'room_not_found'
  | 'name_taken'
  | 'not_joined'
  | 'team_full'
  | 'host_must_speak'
  | 'not_host'
  | 'invalid_state'
  | 'rate_limited'
  | 'session_replaced';

export interface AppError {
  code: ErrorCode;
  message: string;
  suggestions?: string[];
}

export type Ack<T = {}> = (res: ({ ok: true } & T) | ({ ok: false } & AppError)) => void;

export interface JoinPayload {
  roomId: string;
  sessionId: string;
  username: string;
  hostToken?: string;
}

export interface JoinResult {
  /** Your public participant id (also your LiveKit identity). */
  you: string;
  isHost: boolean;
  reclaimed: boolean;
  snapshot: RoomSnapshot;
}

export interface HostPayload {
  hostToken: string;
}

export interface ClientToServerEvents {
  'room:join': (p: JoinPayload, ack: Ack<JoinResult>) => void;
  'role:set': (p: { role: Role; team: TeamIndex | null }, ack: Ack) => void;
  'room:leave': (ack?: Ack) => void;
  /** NTP-lite: server replies with its clock so the client can estimate offset. */
  'time:ping': (ack: (serverNow: number) => void) => void;

  'host:startRound': (p: HostPayload, ack: Ack) => void;
  'host:setHotSeat': (p: HostPayload & { side: TeamIndex; participantId: string }, ack: Ack) => void;
  'host:nextTurn': (p: HostPayload, ack: Ack) => void;
  'host:rotateSpeaker': (p: HostPayload & { side: TeamIndex }, ack: Ack) => void;
  'host:pause': (p: HostPayload, ack: Ack) => void;
  'host:resume': (p: HostPayload, ack: Ack) => void;
  'host:endRound': (p: HostPayload, ack: Ack) => void;
  'host:settings': (p: HostPayload & { turnSeconds: number; roundSeconds: number }, ack: Ack) => void;

  /** Active hot-seat speaker: "I'm done", hands the floor to the other side. */
  'turn:done': (ack: Ack) => void;
  /** Spectators only. clientAt is for debugging; the server decides by arrival order. */
  'buzz:press': (p: { clientAt: number }, ack: Ack<{ result: 'won' | 'too_late' }>) => void;
  'buzz:dismiss': (p: HostPayload, ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  'buzz:locked': (b: BuzzView) => void;
  toast: (t: { type: ToastType; message: string }) => void;
  error: (e: AppError) => void;
  'room:closed': (p: { reason: string }) => void;
}
