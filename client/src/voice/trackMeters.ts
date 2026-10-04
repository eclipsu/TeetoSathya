/**
 * Real-time level meters for audio tracks (local mic + every remote speaker), via Web Audio.
 *
 * Why not only LiveKit's participant.audioLevel? Those values arrive from the server about
 * twice a second, which is too coarse for an 80-120ms glow attack. We read RMS every frame
 * here and use audioLevel only as a fallback floor.
 */
export class TrackMeters {
  private ctx: AudioContext | null = null;
  private meters = new Map<string, { src: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> }>();

  /** Starts the AudioContext. Autoplay rules may leave it suspended until Enable audio. */
  ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  add(id: string, track: MediaStreamTrack) {
    this.remove(id);
    const ctx = this.ensureContext();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser); // analyser only: playback goes through the <audio> element
    this.meters.set(id, { src, analyser, buf: new Float32Array(analyser.fftSize) });
  }

  remove(id: string) {
    const m = this.meters.get(id);
    if (!m) return;
    m.src.disconnect();
    this.meters.delete(id);
  }

  /** Approximate 0-1 loudness (scaled RMS). 0 when there is no meter for this id. */
  level(id: string): number {
    const m = this.meters.get(id);
    if (!m) return 0;
    m.analyser.getFloatTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / m.buf.length) * 3);
  }

  dispose() {
    for (const id of [...this.meters.keys()]) this.remove(id);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
