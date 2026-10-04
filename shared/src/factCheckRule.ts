import type { Role, RoomSnapshot, RoomStatus, TeamIndex } from "./types";

/**
 * Single fact-check eligibility rule, shared by the server (authorization) and the
 * client (button visibility). The server still re-checks on every submit.
 *
 * Eligible: a speaker on the team that does NOT hold the floor, who is not
 * currently allowed to publish audio, and who has not used their one check.
 * Hot-seat on the listening side is allowed, because they are not publishing.
 */
export interface FactCheckContext {
  status: RoomStatus;
  role: Role | null;
  team: TeamIndex | null;
  activeSide: TeamIndex | null;
  /** True when THIS participant is allowed to publish audio right now. */
  publishing: boolean;
  paused: boolean;
  buzzOpen: boolean;
  factCheckOpen: boolean;
  alreadyUsed: boolean;
  speakerPresent: boolean;
}

export function factCheckBlockReason(ctx: FactCheckContext): string | null {
  if (ctx.role !== "speaker" || ctx.team === null)
    return "Only opposing teammates can fact-check.";
  if (ctx.status !== "live") return "The round is not live.";
  if (ctx.alreadyUsed) return "You already used your fact check this round.";
  if (ctx.factCheckOpen) return "A fact check is already in progress.";
  if (ctx.buzzOpen) return "A buzz is in progress.";
  if (ctx.paused) return "The round is paused.";
  if (ctx.activeSide === null || !ctx.speakerPresent)
    return "Nobody is speaking.";
  if (ctx.publishing) return "You are currently speaking.";
  if (ctx.team === ctx.activeSide) return "You can't fact-check your own side.";
  return null;
}

/**
 * Client mirror of server `canPublish` for one public participant id.
 * Lobby: speakers may talk. Ended: nobody. Live: only the active hot seat, and only
 * while the clock is running (pause, buzz, and fact-check all close the mic).
 */
export function publishingFromSnapshot(
  s: RoomSnapshot,
  participantId: string,
): boolean {
  const me = s.participants.find((p) => p.id === participantId);
  if (!me || me.role !== "speaker") return false;
  if (s.status === "ended") return false;
  if (s.status !== "live") return true;
  const g = s.game;
  if (g.paused || g.buzz || g.factCheck || g.activeSide === null) return false;
  return g.hotSeat[g.activeSide] === participantId;
}

export function factCheckContextFromSnapshot(
  s: RoomSnapshot,
  myId: string | null,
): FactCheckContext {
  const me = myId ? s.participants.find((p) => p.id === myId) : undefined;
  const g = s.game;
  const side = g.activeSide;
  return {
    status: s.status,
    role: me?.role ?? null,
    team: me?.team ?? null,
    activeSide: side,
    publishing: myId ? publishingFromSnapshot(s, myId) : false,
    paused: g.paused,
    buzzOpen: g.buzz !== null,
    factCheckOpen: g.factCheck !== null,
    alreadyUsed: !!myId && g.factCheckUsedIds.includes(myId),
    speakerPresent: side !== null && g.hotSeat[side] !== null,
  };
}
