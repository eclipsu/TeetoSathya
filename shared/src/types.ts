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

export type FactVerdict = 'SUPPORTED' | 'CONTRADICTED' | 'INCONCLUSIVE' | 'CORRECT' | 'INCORRECT';
/**
 * Speaker claim contradicted or jury INCORRECT → successful challenge.
 * Speaker claim supported or jury CORRECT → failed challenge.
 * Anything else, including a jury that could not finish → no decision.
 */
export type FactCheckOutcome = 'successful' | 'failed' | 'no_decision';

export type JuryModel = 'gemini' | 'claude' | 'chatgpt';
export type JuryBinary = 'CORRECT' | 'INCORRECT';
export type JuryPhase = 'independent' | 'deliberating';

/** Seated jurors. Claude is off until `'claude'` is added back here. */
export const JURY_SEATS: readonly JuryModel[] = ['gemini', 'chatgpt'];

/** One juror's independent vote and their vote after seeing the other two. */
export interface JuryVote {
  model: JuryModel;
  role: string;
  initialVerdict: JuryBinary;
  initialConfidence: number;
  finalVerdict: JuryBinary;
  finalConfidence: number;
  changedVote: boolean;
  reasoning: string;
  limitations: string[];
  responseToOthers: string;
}

/** Deterministic tally of the seated jurors' final votes. No model decides this. */
export interface JuryResult {
  claimId: string;
  claim: string;
  /** Null when the seated jurors tie. No vote is invented to break it. */
  verdict: JuryBinary | null;
  votesForCorrect: number;
  votesForIncorrect: number;
  /** Average confidence of the winning side. A 2–1 split multiplies that by 0.90. */
  juryConfidence: number;
  unanimous: boolean;
  votes: JuryVote[];
  completedAt: number;
}

/** One challengeable claim offered to the challenger. Not a fact-check result. */
export interface ClaimOption {
  id: string;
  text: string;
  createdAt: number;
}

/** Room-visible fact-check. `speakerId` / `challengerId` are public participant ids. */
export interface FactCheckView {
  id: string;
  challengerId: string;
  challengerName: string;
  speakerId: string;
  speakerName: string;
  claim: string;
  status: 'checking' | 'resolved';
  verdict: FactVerdict | null;
  outcome: FactCheckOutcome | null;
  explanation: string | null;
  /** True when the jury could not finish. Outcome is no decision; the attempt stays used. */
  unavailable: boolean;
  /** Set while the jury is running. Null once the check has a result. */
  juryPhase: JuryPhase | null;
  jury: JuryResult | null;
  createdAt: number;
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
  /** The fact-check currently holding the floor, if any. Cleared when the host resumes. */
  factCheck: FactCheckView | null;
  /** Resolved and in-progress checks for this round, oldest first. */
  factChecks: FactCheckView[];
  /** Public participant ids that have submitted their one fact-check this round. */
  factCheckUsedIds: string[];
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
