import type { BuzzView, ClaimOption, Role, RoomSnapshot, TeamIndex } from './types';

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
  /** Sent after the LiveKit connection is up so the server re-syncs mic permission. */
  'voice:joined': (ack?: Ack) => void;
  /** NTP-lite: server replies with its clock so the client can estimate offset. */
  'time:ping': (ack: (serverNow: number) => void) => void;

  'host:startRound': (p: HostPayload, ack: Ack) => void;
  'host:setHotSeat': (p: HostPayload & { side: TeamIndex; participantId: string }, ack: Ack) => void;
  'host:nextTurn': (p: HostPayload, ack: Ack) => void;
  'host:rotateSpeaker': (p: HostPayload & { side: TeamIndex }, ack: Ack) => void;
  'host:pause': (p: HostPayload, ack: Ack) => void;
  'host:resume': (p: HostPayload, ack: Ack) => void;
  'host:endRound': (p: HostPayload, ack: Ack) => void;
  /** Break a tied round after it ended: a side, or 'draw'. */
  'host:pickWinner': (p: HostPayload & { winner: TeamIndex | 'draw' }, ack: Ack) => void;
  'host:settings': (p: HostPayload & { turnSeconds: number; roundSeconds: number }, ack: Ack) => void;

  /** Active hot-seat speaker: "I'm done", hands the floor to the other side. */
  'turn:done': (ack: Ack) => void;
  /** Spectators only. clientAt is for debugging; the server decides by arrival order. */
  'buzz:press': (p: { clientAt: number }, ack: Ack<{ result: 'won' | 'too_late' }>) => void;
  'buzz:dismiss': (p: HostPayload, ack: Ack) => void;

  /**
   * PCM16 mono 16 kHz from the LiveKit mic track. Accepted only while this socket
   * is the server-authoritative hot-seat speaker. No ack (high frequency).
   */
  'transcript:audio': (chunk: Uint8Array) => void;
  /**
   * Latest claims of the current opposing speaker. Read-only: does not pause the round,
   * cut anyone's mic or consume the fact-check. Only `factcheck:submit` challenges.
   */
  'factcheck:options': (ack: Ack<{ claims: ClaimOption[]; speakerId: string | null; speakerName: string | null }>) => void;
  /** TEMP: run claim extraction on a fixed sentence. Delete with the test button. */
  'claims:demo': (ack: Ack<{ gemini: string; claude: string; claims: string[] }>) => void;
  'factcheck:submit': (p: { claimId: string }, ack: Ack) => void;
  /** Challenger opened (true) or closed (false) the claim picker. Only shows a label to the room. */
  'factcheck:considering': (p: { on: boolean }, ack: Ack) => void;
  'factcheck:dismiss': (p: HostPayload, ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  'buzz:locked': (b: BuzzView) => void;
  /** Interim (non-final) transcript for the current hot-seat speaker. Not stored. */
  'transcript:interim': (p: { speakerId: string; text: string }) => void;
  /** ElevenLabs session health. Debate rules keep running when this is false. */
  'transcript:status': (p: { available: boolean }) => void;
  toast: (t: { type: ToastType; message: string }) => void;
  error: (e: AppError) => void;
  'room:closed': (p: { reason: string }) => void;
}
