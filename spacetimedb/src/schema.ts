import { schema, table, t } from 'spacetimedb/server';

const room = table(
  { name: 'room', public: true },
  {
    roomId: t.string().primaryKey(),
    topic: t.string(),
    status: t.string(),
    teamALabel: t.string(),
    teamBLabel: t.string(),
    createdAtMs: t.i64(),
    turnSeconds: t.i32(),
    roundSeconds: t.i32(),
    speakersPerTeamMax: t.i32(),
  },
);

/** Whoever first published this database. Private: lets a fresh database (local dev) accept its publisher's writes. */
const moduleOwner = table(
  { name: 'module_owner', public: false },
  {
    identity: t.identity().primaryKey(),
  },
);

/**
 * The live index of every debate: one small row per room, kept current by the game server.
 * The lobby subscribes to the rows that aren't over, so many concurrent debates stay cheap to list.
 */
const liveDebate = table(
  {
    name: 'live_debate',
    public: true,
    indexes: [{ accessor: 'by_phase', algorithm: 'btree', columns: ['phase'] }],
  },
  {
    roomId: t.string().primaryKey(),
    topic: t.string(),
    teamALabel: t.string(),
    teamBLabel: t.string(),
    /** LOBBY, LIVE, FACT_CHECK, TIEBREAK, BREAK, ENDED */
    phase: t.string(),
    round: t.i32(),
    totalRounds: t.i32(),
    scoreA: t.i32(),
    scoreB: t.i32(),
    speakerName: t.string(),
    /** TEAM_A, TEAM_B or NONE */
    speakerSide: t.string(),
    roundClaim: t.string(),
    players: t.i32(),
    listeners: t.i32(),
    /** Winner when ENDED: TEAM_A, TEAM_B, DRAW or NONE (tie, host to pick). */
    winner: t.string(),
    updatedAtMs: t.i64(),
  },
);

/**
 * Each debate's working context, one row per room: the last spoken lines and the latest verdicts.
 * One indexed lookup by roomId gives any viewer (or a restarted service) the state of the argument.
 */
const debateContext = table(
  { name: 'debate_context', public: true },
  {
    roomId: t.string().primaryKey(),
    /** Most recent transcript lines, oldest first, as "Name: text" separated by newlines. */
    recentLines: t.string(),
    /** Most recent fact-check results, newest first, as "Name challenged Name: claim → result" lines. */
    recentVerdicts: t.string(),
    updatedAtMs: t.i64(),
  },
);

/** Host token never leaves the database. Clients cannot subscribe. */
const roomSecret = table(
  { name: 'room_secret', public: false },
  {
    roomId: t.string().primaryKey(),
    hostToken: t.string(),
    hostParticipantId: t.string(),
  },
);

const participant = table(
  {
    name: 'participant',
    public: true,
    indexes: [{ accessor: 'by_room', algorithm: 'btree', columns: ['roomId'] }],
  },
  {
    participantId: t.string().primaryKey(),
    roomId: t.string(),
    displayName: t.string(),
    role: t.string(),
    queuePosition: t.i32(),
    connected: t.bool(),
    joinedAtMs: t.i64(),
    timeUsedMs: t.i64(),
  },
);

/** sessionId is the private reclaim key. Not subscribed by browsers. */
const participantSecret = table(
  { name: 'participant_secret', public: false },
  {
    participantId: t.string().primaryKey(),
    sessionId: t.string().unique(),
  },
);

const round = table(
  {
    name: 'round',
    public: true,
    indexes: [{ accessor: 'by_room', algorithm: 'btree', columns: ['roomId'] }],
  },
  {
    roundId: t.string().primaryKey(),
    roomId: t.string(),
    seq: t.i32(),
    status: t.string(),
    startedAtMs: t.i64(),
    endedAtMs: t.i64(),
    roundDurationMs: t.i64(),
    winner: t.string(),
    finalScoreA: t.i32(),
    finalScoreB: t.i32(),
  },
);

const gameState = table(
  { name: 'game_state', public: true },
  {
    roomId: t.string().primaryKey(),
    roundId: t.string(),
    phase: t.string(),
    activeSide: t.string(),
    activeSpeakerId: t.string(),
    scoreA: t.i32(),
    scoreB: t.i32(),
    roundEndsAtMs: t.i64(),
    roundRemainingMs: t.i64(),
    speakerStartedAtMs: t.i64(),
    readySpeakerId: t.string(),
    readyEndsAtMs: t.i64(),
    activeFactCheckId: t.string(),
    paused: t.bool(),
  },
);

const speakerState = table(
  {
    name: 'speaker_state',
    public: true,
    indexes: [{ accessor: 'by_round', algorithm: 'btree', columns: ['roundId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    stateKey: t.string().unique(),
    roundId: t.string(),
    participantId: t.string(),
    remainingMs: t.i64(),
  },
);

const speakerQueue = table(
  {
    name: 'speaker_queue',
    public: true,
    indexes: [{ accessor: 'by_round_side', algorithm: 'btree', columns: ['roundId', 'side'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    queueKey: t.string().unique(),
    roundId: t.string(),
    side: t.string(),
    position: t.i32(),
    participantId: t.string(),
  },
);

const transcriptSegment = table(
  {
    name: 'transcript_segment',
    public: true,
    indexes: [{ accessor: 'by_round', algorithm: 'btree', columns: ['roundId'] }],
  },
  {
    id: t.string().primaryKey(),
    roomId: t.string(),
    roundId: t.string(),
    speakerId: t.string(),
    side: t.string(),
    text: t.string(),
    createdAtMs: t.i64(),
  },
);

const claim = table(
  {
    name: 'claim',
    public: true,
    indexes: [{ accessor: 'by_round_speaker', algorithm: 'btree', columns: ['roundId', 'speakerId'] }],
  },
  {
    id: t.string().primaryKey(),
    roomId: t.string(),
    roundId: t.string(),
    speakerId: t.string(),
    side: t.string(),
    claim: t.string(),
    originalText: t.string(),
    createdAtMs: t.i64(),
  },
);

/**
 * Live state of each claim in its speaker's 5-idea buffer (one row per claim, upserted).
 * evictedAtMs = 0 while the idea is live; set when a newer idea pushed it out. The claim row
 * keeps the first wording; `text` here is the latest (restatements refine it in place).
 */
const claimIdea = table(
  {
    name: 'claim_idea',
    public: true,
    indexes: [{ accessor: 'by_round_speaker', algorithm: 'btree', columns: ['roundId', 'speakerId'] }],
  },
  {
    claimId: t.string().primaryKey(),
    roomId: t.string(),
    roundId: t.string(),
    speakerId: t.string(),
    text: t.string(),
    relevance: t.f64(),
    admittedAtMs: t.i64(),
    updatedAtMs: t.i64(),
    evictedAtMs: t.i64(),
  },
);

const factCheck = table(
  {
    name: 'fact_check',
    public: true,
    indexes: [{ accessor: 'by_round', algorithm: 'btree', columns: ['roundId'] }],
  },
  {
    id: t.string().primaryKey(),
    roomId: t.string(),
    roundId: t.string(),
    challengerId: t.string(),
    challengingSide: t.string(),
    speakerId: t.string(),
    speakerSide: t.string(),
    claimId: t.string(),
    claimText: t.string(),
    status: t.string(),
    finalVerdict: t.string(),
    challengeOutcome: t.string(),
    scoreDelta: t.i32(),
    speakerRotated: t.bool(),
    nextSpeakerId: t.string(),
    createdAtMs: t.i64(),
    resolvedAtMs: t.i64(),
  },
);

/** One row per participant per round. usageKey is unique, so a second insert rolls back. */
const factCheckUsage = table(
  { name: 'fact_check_usage', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    usageKey: t.string().unique(),
    roundId: t.string(),
    participantId: t.string(),
    factCheckId: t.string(),
    usedAtMs: t.i64(),
  },
);

const factCheckVote = table(
  {
    name: 'fact_check_vote',
    public: true,
    indexes: [{ accessor: 'by_check', algorithm: 'btree', columns: ['factCheckId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    voteKey: t.string().unique(),
    factCheckId: t.string(),
    provider: t.string(),
    verdict: t.string(),
    confidence: t.f64(),
  },
);

const gameEvent = table(
  {
    name: 'game_event',
    public: true,
    indexes: [{ accessor: 'by_room', algorithm: 'btree', columns: ['roomId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.string(),
    roundId: t.string(),
    type: t.string(),
    participantId: t.string(),
    side: t.string(),
    points: t.i32(),
    createdAtMs: t.i64(),
  },
);

const scheduleReady = table(
  {
    name: 'schedule_ready',
    public: false,
    indexes: [{ accessor: 'by_room', algorithm: 'btree', columns: ['roomId'] }],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    roomId: t.string(),
  },
);

const scheduleRound = table(
  {
    name: 'schedule_round',
    public: false,
    indexes: [{ accessor: 'by_room', algorithm: 'btree', columns: ['roomId'] }],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    roomId: t.string(),
  },
);

const spacetimedb = schema({
  moduleOwner,
  liveDebate,
  debateContext,
  room,
  roomSecret,
  participant,
  participantSecret,
  round,
  gameState,
  speakerState,
  speakerQueue,
  transcriptSegment,
  claim,
  claimIdea,
  factCheck,
  factCheckUsage,
  factCheckVote,
  gameEvent,
  scheduleReady,
  scheduleRound,
});

export default spacetimedb;
export { scheduleReady, scheduleRound };
