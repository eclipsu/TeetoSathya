import { readJSON, writeJSON } from './storage';

/** Synthesized sound effects (Web Audio oscillators, no audio files). Respects a global mute. */
const KEY = 'teeto.sfx';
let enabled = readJSON<boolean>(KEY, true);
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

export function sfxEnabled() {
  return enabled;
}
export function setSfxEnabled(v: boolean) {
  enabled = v;
  writeJSON(KEY, v);
  listeners.forEach((l) => l());
}
export function onSfxChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Call from any user gesture so later sounds are allowed to play. */
export function primeAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no Web Audio: stay silent */
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Game-show buzzer: two short detuned square-wave blasts. */
export function playBuzz() {
  if (!enabled) return;
  primeAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  tone(196, t, 0.22, 'square', 0.12);
  tone(207, t, 0.22, 'square', 0.08);
  tone(196, t + 0.26, 0.32, 'square', 0.12);
  tone(207, t + 0.26, 0.32, 'square', 0.08);
}

/** Soft chime when the floor passes to you. */
export function playYourTurn() {
  if (!enabled) return;
  primeAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  tone(660, t, 0.18, 'sine', 0.1);
  tone(880, t + 0.12, 0.25, 'sine', 0.1);
}
