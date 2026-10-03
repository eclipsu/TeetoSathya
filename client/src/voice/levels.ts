/**
 * Smoothed per-participant audio levels for the speaking glow.
 *
 * The source (VoiceProvider) reports a raw 0-1 level per participant every frame: a Web Audio
 * meter on their audio track, floored by LiveKit's server-reported `audioLevel`. One
 * requestAnimationFrame loop eases the displayed level toward it: fast attack so the glow
 * reacts as soon as someone talks, slow release so it doesn't flicker between words.
 */

// ---- Tunables (one place) ----
/** Smoothed level above which someone counts as "speaking". */
export const SPEAKING_THRESHOLD = 0.12;
/** Time constant for rising levels (ms). */
export const ATTACK_MS = 90;
/** Time constant for falling levels (ms). */
export const RELEASE_MS = 320;
/** Perceptual curve: raw speech levels are small, so lift them before display. */
const shape = (raw: number) => Math.min(1, Math.sqrt(Math.max(0, raw)) * 1.35);
/** Only notify React when the level moves at least this much (keeps re-renders cheap). */
const NOTIFY_STEP = 0.015;

export interface SpeakingState {
  speaking: boolean;
  level: number;
}
const SILENT: SpeakingState = Object.freeze({ speaking: false, level: 0 });

type Source = () => Iterable<[id: string, rawLevel: number]>;

class LevelStore {
  private source: Source | null = null;
  private smooth = new Map<string, number>();
  private published = new Map<string, SpeakingState>();
  private listeners = new Map<string, Set<() => void>>();
  private raf = 0;
  private last = 0;

  setSource(source: Source | null) {
    this.source = source;
    if (source && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    if (!source) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.smooth.clear();
      for (const id of [...this.published.keys()]) this.publish(id, SILENT);
    }
  }

  get(id: string): SpeakingState {
    return this.published.get(id) ?? SILENT;
  }

  subscribe(id: string, cb: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  private publish(id: string, state: SpeakingState) {
    this.published.set(id, state);
    this.listeners.get(id)?.forEach((cb) => cb());
  }

  private tick = (now: number) => {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    const seen = new Set<string>();
    for (const [id, raw] of this.source?.() ?? []) {
      seen.add(id);
      const target = shape(raw);
      const cur = this.smooth.get(id) ?? 0;
      const tau = target > cur ? ATTACK_MS : RELEASE_MS;
      const next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
      const level = next < 0.005 ? 0 : next;
      this.smooth.set(id, level);
      const prev = this.get(id);
      const speaking = level > SPEAKING_THRESHOLD;
      if (Math.abs(prev.level - level) >= NOTIFY_STEP || prev.speaking !== speaking || (level === 0 && prev.level !== 0)) {
        this.publish(id, { speaking, level: Math.round(level * 100) / 100 });
      }
    }
    // Participants who left voice fade to silent.
    for (const id of this.published.keys()) {
      if (!seen.has(id) && this.get(id) !== SILENT) {
        this.smooth.delete(id);
        this.publish(id, SILENT);
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const levels = new LevelStore();
