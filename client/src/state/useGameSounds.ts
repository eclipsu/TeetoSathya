import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from '@teeto/shared';
import { playFactCorrect, playFactIncorrect, playRoundStart, playTimesUp, playWinner, setTickLoop } from '../lib/sfx';
import { sideRemaining, useServerNow } from './clock';

/** Room sound cues driven by state: round start/end, countdown ticks, time's up, fact-check verdicts. */
export function useGameSounds(s: RoomSnapshot | null) {
  const g = s?.game;
  const live = s?.status === 'live';
  const running = !!s && live && g!.activeSide !== null && g!.clockRunningSince !== null;
  const now = useServerNow(running, 200);
  const ms = running ? sideRemaining(s!, g!.activeSide!, now) : null;

  // Countdown ticks follow the timer colors: amber under 30s, red under 10s.
  const tick = ms === null || ms <= 0 ? null : ms <= 10_000 ? 'tick-fast' : ms <= 30_000 ? 'tick' : null;
  useEffect(() => { setTickLoop(tick); }, [tick]);
  useEffect(() => () => setTickLoop(null), []);

  // Time's up once per running turn: when the local clock reaches zero, or (if the server
  // switched turns before we sampled zero) when the side that just stopped is frozen at 0.
  const turnKey = running ? `${g!.activeSide}:${g!.clockRunningSince}` : null;
  const firedFor = useRef<string | null>(null);
  const lastTurn = useRef<{ key: string; side: 0 | 1 } | null>(null);
  useEffect(() => {
    const prev = lastTurn.current;
    if (prev && prev.key !== turnKey && g && live && g.clocks[prev.side] === 0 && firedFor.current !== prev.key) {
      firedFor.current = prev.key;
      playTimesUp();
    }
    if (turnKey && ms === 0 && firedFor.current !== turnKey) {
      firedFor.current = turnKey;
      playTimesUp();
    }
    lastTurn.current = turnKey ? { key: turnKey, side: g!.activeSide! } : null;
  }, [turnKey, ms]);

  // Round start / end.
  const prevStatus = useRef(s?.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = s?.status;
    if (!prev || !s) return;
    if (prev === 'lobby' && s.status === 'live') playRoundStart();
    // A decided winner gets the winner clip; a tie waits for the host with the time's-up sound.
    if (prev === 'live' && s.status === 'ended') {
      if (s.game.winner === 0 || s.game.winner === 1) playWinner();
      else playTimesUp(true);
    }
  }, [s?.status]);

  // Rounds 2+: chime when the next round begins (round 1 is the lobby → live chime above).
  const prevRound = useRef(g?.round ?? 0);
  useEffect(() => {
    const before = prevRound.current;
    prevRound.current = g?.round ?? 0;
    if (live && before > 0 && (g?.round ?? 0) > before) playRoundStart();
  }, [g?.round]);

  // Host broke a tie after the round ended. `wasEnded` is last commit's status, so the
  // snapshot that ends the round with a winner doesn't play the clip twice.
  const prevWinner = useRef(g?.winner ?? null);
  const wasEnded = useRef(s?.status === 'ended');
  useEffect(() => {
    const before = prevWinner.current;
    prevWinner.current = g?.winner ?? null;
    if (wasEnded.current && before === null && (g?.winner === 0 || g?.winner === 1)) playWinner();
  }, [g?.winner]);
  useEffect(() => { wasEnded.current = s?.status === 'ended'; });

  // Fact-check verdicts: only checks seen resolving now, never history loaded on join.
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!g) return;
    const first = seen.current === null;
    const map = seen.current ?? new Map<string, string>();
    for (const f of g.factChecks) {
      const before = map.get(f.id);
      map.set(f.id, f.status);
      if (first || f.status !== 'resolved' || before === 'resolved') continue;
      if (f.unavailable) continue;
      if (f.verdict === 'INCORRECT' || f.verdict === 'CONTRADICTED') playFactIncorrect();
      else if (f.verdict === 'CORRECT' || f.verdict === 'SUPPORTED') playFactCorrect();
    }
    seen.current = map;
  }, [g?.factChecks]);
}
