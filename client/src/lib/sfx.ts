import { readJSON, writeJSON } from './storage';

/** Sound effects: synthesized tones (Web Audio) plus clips from /public/sounds. Respects a global mute. */
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
  if (!v) stopAllClips();
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
    CLIPS.forEach(clip); // warm the cache so the first cue isn't late
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

/** A spectator buzzed in (ElevenLabs sound, buzz.mp3). */
export function playBuzz() {
  playClip('buzz', { volume: 0.8 });
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

/** Air whoosh for the challenge card sliding in: filtered noise with a rising then falling sweep. */
export function playWhoosh() {
  if (!enabled) return;
  primeAudio();
  if (!ctx) return;
  const dur = 0.55;
  const t = ctx.currentTime + 0.01;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(300, t);
  filter.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.45);
  filter.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---- Clips (client/public/sounds) ----

const CLIPS = ['start', 'tick', 'tick-fast', 'timesup', 'correct', 'fail', 'winner', 'buzz', 'challenge', 'tiebreak', 'jury-thinking'] as const;
type ClipName = (typeof CLIPS)[number];
const SOUND_BASE = `${import.meta.env.BASE_URL}sounds/`;
const clips = new Map<ClipName, HTMLAudioElement>();
const fades = new Map<ClipName, ReturnType<typeof setTimeout>>();

function clip(name: ClipName): HTMLAudioElement {
  let a = clips.get(name);
  if (!a) {
    a = new Audio(`${SOUND_BASE}${name}.mp3`);
    a.preload = 'auto';
    clips.set(name, a);
  }
  return a;
}

function stopClip(name: ClipName) {
  const t = fades.get(name);
  if (t) clearTimeout(t);
  fades.delete(name);
  const a = clips.get(name);
  if (a) {
    a.pause();
    a.currentTime = 0;
  }
}

function stopAllClips() {
  CLIPS.forEach(stopClip);
  tickLoop = null;
  juryLoop = false;
}

/** Play a clip from the start. `maxMs` cuts it short with a 300ms fade. */
function playClip(name: ClipName, { volume = 0.7, maxMs }: { volume?: number; maxMs?: number } = {}) {
  if (!enabled) return;
  stopClip(name);
  const a = clip(name);
  a.loop = false;
  a.volume = volume;
  a.play().catch(() => {
    /* autoplay not unlocked yet: stay silent */
  });
  if (maxMs) {
    const fadeMs = 300;
    fades.set(name, setTimeout(() => {
      const steps = 6;
      let i = 0;
      const step = () => {
        i++;
        a.volume = Math.max(0, volume * (1 - i / steps));
        if (i < steps) fades.set(name, setTimeout(step, fadeMs / steps));
        else stopClip(name);
      };
      step();
    }, Math.max(0, maxMs - fadeMs)));
  }
}

export const playRoundStart = () => playClip('start');
/** Turn clock ran out (short) or the round ended (longer). */
export const playTimesUp = (long = false) => playClip('timesup', { maxMs: long ? 5000 : 3000 });
export const playFactCorrect = () => playClip('correct');
export const playFactIncorrect = () => playClip('fail');
export const playWinner = () => playClip('winner', { volume: 0.8 });
/** Someone called a fact check: the challenge card slides in. */
export const playChallenge = () => playClip('challenge', { volume: 0.8 });
/** The jurors split: tie-break. */
export const playTiebreak = () => playClip('tiebreak', { volume: 0.8 });

let juryLoop = false;
/** Quiet suspense bed under the jurors while they think. Their voices play over it. */
export function setJuryThinkingLoop(on: boolean) {
  if (!enabled) on = false;
  if (on === juryLoop) return;
  juryLoop = on;
  if (!on) return stopClip('jury-thinking');
  const a = clip('jury-thinking');
  a.loop = true;
  a.volume = 0.22;
  a.currentTime = 0;
  a.play().catch(() => {
    juryLoop = false; // retry on the next state change
  });
}

let tickLoop: 'tick' | 'tick-fast' | null = null;
/** Looping countdown tick for the active turn clock: slow under 30s, fast under 10s, null = silent. */
export function setTickLoop(kind: 'tick' | 'tick-fast' | null) {
  if (!enabled) kind = null;
  if (kind === tickLoop) return;
  if (tickLoop) stopClip(tickLoop);
  tickLoop = kind;
  if (!kind) return;
  const a = clip(kind);
  a.loop = true;
  a.volume = 0.45;
  a.currentTime = 0;
  a.play().catch(() => {
    if (tickLoop === kind) tickLoop = null; // retry on the next state change
  });
}
