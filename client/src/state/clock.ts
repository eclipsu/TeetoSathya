import { useEffect, useState } from 'react';
import type { RoomSnapshot, TeamIndex } from '@teeto/shared';
import { serverNow } from '../lib/serverClock';

/** Remaining ms on a side's turn clock, computed locally from server timestamps. */
export function sideRemaining(s: RoomSnapshot, side: TeamIndex, now: number): number {
  const g = s.game;
  if (g.activeSide === side && g.clockRunningSince !== null) return Math.max(0, g.clocks[side] - (now - g.clockRunningSince));
  return g.clocks[side];
}

export function roundRemaining(s: RoomSnapshot, now: number): number {
  const g = s.game;
  if (g.roundEndsAt !== null) return Math.max(0, g.roundEndsAt - now);
  return g.roundRemainingMs ?? s.settings.roundSeconds * 1000;
}

/** Talk time a speaker has used, including the stint that's running right now. */
export function liveTimeUsed(s: RoomSnapshot, participantId: string, now: number): number {
  const p = s.participants.find((x) => x.id === participantId);
  if (!p) return 0;
  const g = s.game;
  const running = g.activeSide !== null && g.hotSeat[g.activeSide] === participantId && g.clockRunningSince !== null;
  return p.timeUsedMs + (running ? Math.min(g.clocks[g.activeSide!], now - g.clockRunningSince!) : 0);
}

/**
 * Re-render ~10x/s with the current SERVER time (client clock + measured offset).
 * Display never depends on how often the server broadcasts.
 */
export function useServerNow(active = true, everyMs = 100): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return active ? now : serverNow();
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
