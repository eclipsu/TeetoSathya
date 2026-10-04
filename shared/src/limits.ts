export const LIMITS = {
  usernameMin: 2,
  usernameMax: 20,
  topicMax: 120,
  sideMax: 30,
  speakersPerTeamMax: 4,
  turnSecondsMin: 15,
  turnSecondsMax: 900,
  turnSecondsDefault: 120,
  roundSecondsMin: 60,
  roundSecondsMax: 7200,
  roundSecondsDefault: 600,
  totalRoundsMin: 1,
  totalRoundsMax: 5,
  totalRoundsDefault: 3,
  reclaimGraceMs: 30_000,
  idleRoomMs: 5 * 60_000,
  maxRooms: 100,
} as const;

/**
 * Browsers play the host and juror voices this much faster than ElevenLabs renders them (pitch is
 * kept). Server pacing and the typewriter use the shortened length, so everything stays in step.
 */
export const SPOKEN_PLAYBACK_RATE = 1.15;
