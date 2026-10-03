import { useEffect, useRef } from 'react';
import { isModalOpen } from '../components/Modal';

const COOLDOWN_MS = 1500;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Global SPACE handler. Ignores key repeat, typing in fields, and open dialogs.
 * preventDefault stops page scroll and stops Space from "clicking" a focused button.
 * `trigger` returns a function the on-screen button can share (same cooldown).
 */
export function useSpaceKey(enabled: boolean, onPress: () => void): () => void {
  const last = useRef(0);
  const cb = useRef(onPress);
  cb.current = onPress;

  const fire = useRef(() => {
    const now = Date.now();
    if (now - last.current < COOLDOWN_MS) return;
    last.current = now;
    cb.current();
  }).current;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (isTypingTarget(e.target) || isModalOpen()) return;
      e.preventDefault();
      if (e.repeat) return;
      fire();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, fire]);

  return fire;
}
