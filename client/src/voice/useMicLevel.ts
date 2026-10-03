import { useEffect, useState } from 'react';

/**
 * Live 0-1 level of a local MediaStreamTrack via Web Audio (RMS). Used for the "Test mic"
 * meter and the user's own level meter; more responsive than server-reported levels.
 */
export function useMicLevel(track: MediaStreamTrack | null | undefined): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track || track.readyState !== 'live') {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const target = Math.min(1, rms * 4);
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
      setLevel(Math.round(smooth * 50) / 50);
      raf = requestAnimationFrame(loop);
    };
    void ctx.resume().catch(() => {});
    loop();
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      void ctx.close();
    };
  }, [track]);
  return level;
}

export type MicErrorKind = 'denied' | 'notfound' | 'insecure' | 'other';

export function micErrorKind(err: unknown): MicErrorKind {
  if (!navigator.mediaDevices || !window.isSecureContext) return 'insecure';
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notfound';
  return 'other';
}

export const MIC_HELP: Record<MicErrorKind, string> = {
  denied: 'Microphone blocked. Click the lock/site-settings icon in the address bar, allow the microphone, then try again.',
  notfound: 'No microphone found. Plug one in (or pick one in your OS sound settings) and try again.',
  insecure: 'The mic only works on https:// or localhost. See the banner at the top for the Chrome flag fix.',
  other: 'Could not start the microphone. Another app may be using it; close it and try again.',
};
