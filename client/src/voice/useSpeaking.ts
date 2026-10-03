import { useCallback, useSyncExternalStore, type CSSProperties } from 'react';
import { levels, type SpeakingState } from './levels';

/** { speaking, level } for a participant's public id. level is 0-1, smoothed. */
export function useSpeaking(participantId: string | null | undefined): SpeakingState {
  const id = participantId ?? '';
  const subscribe = useCallback((cb: () => void) => levels.subscribe(id, cb), [id]);
  return useSyncExternalStore(subscribe, () => levels.get(id));
}

/** Convenience: inline style carrying --level for CSS-driven glow. */
export function levelStyle(level: number): CSSProperties {
  return { ['--level' as string]: level.toFixed(2) };
}
