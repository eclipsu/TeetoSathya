export type TeamIndex = 0 | 1;
export type RoomStatus = 'lobby' | 'live' | 'ended';
export type Role = 'speaker' | 'spectator';

export interface RoomSettings {
  speakersPerTeamMax: number;
  /** Talk-time budget per speaker, set by the host. */
  turnSeconds: number;
  /** Total round length, set by the host. */
  roundSeconds: number;
  /** Host asked the jury to explain itself: longer spoken lines. Off = one short line each. */
  juryDetailed: boolean;
  /** Rounds in a game, set by the host in the lobby. */
  totalRounds: number;
}

/** Why a round ended: a team ran out of speakers, the round clock ran out, or the host ended it. */
export type RoundEnd = 'out' | 'time' | 'host';

export interface RoundLogEntry {
  number: number;
  openingSide: TeamIndex;
  openerName: string | null;
  claim: string | null;
  endedBy: RoundEnd;
  /** The team that ran out of speakers, when endedBy is 'out'. */
  outTeam: TeamIndex | null;
}

/** Between rounds: clocks are frozen and the next opener is already chosen. */
export interface IntermissionView {
  until: number;
  nextRound: number;
  openingSide: TeamIndex;
  openerId: string | null;
  endedBy: RoundEnd;
  outTeam: TeamIndex | null;
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

export type JuryModel = 'gemini' | 'gemini_skeptic' | 'groq' | 'claude' | 'chatgpt';
export type JuryBinary = 'CORRECT' | 'INCORRECT';
export type JuryPhase = 'independent' | 'deliberating';

/**
 * Gemini evidence uses GEMINI_API_KEY or GEMINI_FACTS_KEY.
 * Claude skeptic uses CLAUDE_API_KEY.
 * Groq is not seated.
 */
export const JURY_SEATS: readonly JuryModel[] = ['gemini', 'claude'];

/** One juror's independent vote and their vote after seeing the other two. */
export interface JuryVote {
  model: JuryModel;
  role: string;
  initialVerdict: JuryBinary;
  initialConfidence: number;
  finalVerdict: JuryBinary;
  /** False when this juror found the claim off the room topic. */
  onTopic: boolean;
  finalConfidence: number;
  changedVote: boolean;
  reasoning: string;
  limitations: string[];
  responseToOthers: string;
  /** Short line said to the room. Falls back to the reasoning's first sentence. */
  spoken?: string;
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
  /** True when every seated juror found the claim off the room topic. The verdict is then INCORRECT. */
  offTopic: boolean;
  votes: JuryVote[];
  completedAt: number;
}

/** One line in the jurors' live conversation, appended as each model answers. */
export interface JuryMessage {
  id: string;
  model: JuryModel;
  /** 'opening' = independent read of the claim; 'reply' = answer after reading the other juror. */
  stage: 'opening' | 'reply';
  verdict: JuryBinary;
  confidence: number;
  /** One short spoken line, also read aloud with this juror's voice. */
  text: string;
  /** Reply only: the juror switched sides after reading the other one. */
  changedVote: boolean;
  at: number;
  /** Length of the spoken audio, so the text types out in step with it. Null when there is no audio. */
  audioMs: number | null;
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
  /** The jurors' conversation so far, oldest first. */
  thread: JuryMessage[];
  /** Jurors still writing their next message. Empty once the check resolves. */
  thinking: JuryModel[];
  createdAt: number;
  /** Points this check added to the challenger's team. Null while it is still running. */
  scoreDelta: number | null;
}

export interface GameView {
  /** 1-based round number; 0 before the first round starts. */
  round: number;
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
  /** Server time when the clocks resume after a finished fact check. Null until the verdict is in. */
  factCheckResumeAt: number | null;
  /** Resolved and in-progress checks for this round, oldest first. */
  factChecks: FactCheckView[];
  /** Public participant ids that have submitted their one fact-check this round. */
  factCheckUsedIds: string[];
  /** Public participant ids with the claim picker open. The round keeps going. */
  consideringIds: string[];
  /** Team A, Team B. Authoritative. Reset when a round starts. */
  scores: [number, number];
  /** The host's opening announcement. Clocks hold until `until`, then the opener has the floor. */
  intro: { text: string; until: number } | null;
  /** Speakers knocked out this round by a challenge that landed. They can't take the hot seat again until the next round. */
  eliminatedIds: string[];
  /** The opener's first claim: what this round is about. Null until they make one. */
  roundClaim: { text: string; speakerId: string } | null;
  /** Who opened this round. */
  openerId: string | null;
  intermission: IntermissionView | null;
  /** Finished rounds, oldest first. */
  roundLog: RoundLogEntry[];
  /** Set once the round has ended and a winner is known. Null while live, or on a tie until the host picks. */
  winner: import('./score').RoundWinner | null;
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
