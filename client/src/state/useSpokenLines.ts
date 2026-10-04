import { useEffect, useRef, useState } from 'react';
import { SPOKEN_PLAYBACK_RATE } from '@teeto/shared';
import { onSfxChange, sfxEnabled } from '../lib/sfx';
import type { RoomSocket } from './useRoom';

interface Line {
  /** Jury message id, or INTRO_ID for the host's round announcement. */
  messageId: string;
  url: string;
  delayMs: number;
}

const VOLUME = 0.9;
export const INTRO_ID = 'intro';
/** Let the round-start chime finish before the host starts talking. */
const INTRO_DELAY_MS = 700;

/**
 * Plays spoken lines as they arrive, one at a time and in order: the host's round announcement
 * and the jurors' messages. The sound toggle mutes them too. Returns the id of the line being
 * spoken (a jury message id or INTRO_ID), so the UI can show who is talking.
 */
export function useSpokenLines(socket: RoomSocket | null): string | null {
  const [speaking, setSpeaking] = useState<string | null>(null);
  const queue = useRef<Line[]>([]);
  const current = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!socket) return;

    const stopAll = () => {
      current.current?.pause();
      current.current = null;
      for (const line of queue.current) URL.revokeObjectURL(line.url);
      queue.current = [];
      setSpeaking(null);
    };

    const playNext = () => {
      if (current.current) return;
      const line = queue.current.shift();
      if (!line) return setSpeaking(null);
      const audio = new Audio(line.url);
      audio.volume = VOLUME;
      audio.playbackRate = SPOKEN_PLAYBACK_RATE;
      audio.preservesPitch = true;
      current.current = audio;
      const done = () => {
        URL.revokeObjectURL(line.url);
        if (current.current === audio) current.current = null;
        playNext();
      };
      audio.onended = done;
      audio.onerror = done;
      // Autoplay is unlocked by the first click in the room; if not, skip this line quietly.
      const start = () => {
        if (current.current !== audio) return;
        setSpeaking(line.messageId);
        audio.play().catch(done);
      };
      if (line.delayMs > 0) setTimeout(start, line.delayMs);
      else start();
    };

    const enqueue = (messageId: string, audio: Uint8Array | ArrayBuffer, delayMs = 0) => {
      if (!sfxEnabled()) return;
      const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio;
      queue.current.push({ messageId, delayMs, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/mpeg' })) });
      playNext();
    };

    const onVoice = (p: { messageId: string; audio: Uint8Array | ArrayBuffer }) => enqueue(p.messageId, p.audio);
    const onAnnounce = (p: { audio: Uint8Array | ArrayBuffer }) => enqueue(INTRO_ID, p.audio, INTRO_DELAY_MS);

    socket.on('jury:voice', onVoice);
    socket.on('room:announce', onAnnounce);
    const offSfx = onSfxChange(() => { if (!sfxEnabled()) stopAll(); });
    return () => {
      socket.off('jury:voice', onVoice);
      socket.off('room:announce', onAnnounce);
      offSfx();
      stopAll();
    };
  }, [socket]);

  return speaking;
}
