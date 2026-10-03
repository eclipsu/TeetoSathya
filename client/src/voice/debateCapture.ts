import { useEffect, useRef } from 'react';
import type { RoomSocket } from '../state/useRoom';

const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.parts = [];
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.parts.push(new Float32Array(ch));
      this.n += ch.length;
      if (this.n >= Math.round(sampleRate * 0.1)) {
        const merged = new Float32Array(this.n);
        let o = 0;
        for (const p of this.parts) { merged.set(p, o); o += p.length; }
        this.port.postMessage(merged, [merged.buffer]);
        this.parts = [];
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

function downsampleTo16k(input: Float32Array, inRate: number): Uint8Array {
  const ratio = inRate / 16000;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0;
    const c = Math.max(-1, Math.min(1, s));
    pcm[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

/**
 * Taps the microphone track LiveKit is already publishing and forwards PCM to
 * the server. The server decides whether this socket is the hot-seat speaker;
 * this component only runs while the client believes it holds the floor.
 */
export function DebateCapture({ socket, track, enabled }: { socket: RoomSocket | null; track: MediaStreamTrack | null; enabled: boolean }) {
  const socketRef = useRef(socket);
  socketRef.current = socket;

  useEffect(() => {
    if (!enabled || !track) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let stopped = false;
    let ctx: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));

    void (async () => {
      try {
        ctx = new Ctx();
        await ctx.resume();
        await ctx.audioWorklet.addModule(url);
        if (stopped || !ctx) return;
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        node = new AudioWorkletNode(ctx, 'pcm-tap');
        const rate = ctx.sampleRate;
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
          const s = socketRef.current;
          if (!s?.connected || !(ev.data instanceof Float32Array)) return;
          s.emit('transcript:audio', downsampleTo16k(ev.data, rate));
        };
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
      } catch (err) {
        console.warn('[stt] mic tap failed:', (err as Error).message);
      }
    })();

    return () => {
      stopped = true;
      URL.revokeObjectURL(url);
      try { node?.disconnect(); } catch { /* already stopped */ }
      void ctx?.close();
    };
  }, [enabled, track]);

  return null;
}
