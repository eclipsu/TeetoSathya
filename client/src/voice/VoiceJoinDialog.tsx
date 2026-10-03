import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { HeadphonesIcon, MicIcon } from '../components/icons';
import { MIC_HELP, micErrorKind, useMicLevel, type MicErrorKind } from './useMicLevel';
import { LevelMeter } from './LevelMeter';

interface Props {
  open: boolean;
  isSpeaker: boolean;
  onJoin: () => void;
  onClose: () => void;
}

/** "Join voice" step. The click also satisfies the browser's autoplay rule. Speakers can test their mic first. */
export function VoiceJoinDialog({ open, isSpeaker, onJoin, onClose }: Props) {
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [err, setErr] = useState<MicErrorKind | null>(null);
  const [testing, setTesting] = useState(false);
  const level = useMicLevel(track);

  useEffect(() => {
    if (!open) {
      track?.stop();
      setTrack(null);
      setTesting(false);
    }
  }, [open, track]);

  async function testMic() {
    setErr(null);
    setTesting(true);
    try {
      if (!navigator.mediaDevices) throw new Error('insecure');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      setTrack(stream.getAudioTracks()[0] ?? null);
    } catch (e) {
      setErr(micErrorKind(e));
      setTesting(false);
    }
  }

  function join() {
    track?.stop(); // LiveKit opens its own capture
    setTrack(null);
    onJoin();
  }

  return (
    <Modal open={open} onClose={onClose} title="Join voice">
      <div className="stack">
        <p className="muted voice-join__lead">
          <HeadphonesIcon /> Use headphones if other players are in the same room, otherwise you'll hear echo.
        </p>
        {isSpeaker ? (
          <>
            <p className="muted">
              Speakers talk one at a time: when the round is live, your mic only opens while you hold the hot seat and it's your turn.
            </p>
            <div className="voice-test glass">
              <MicIcon />
              <LevelMeter level={level} segments={16} />
              {!track && (
                <button className="btn btn--ghost btn--sm" onClick={testMic} disabled={testing}>
                  {testing ? 'Asking…' : 'Test mic'}
                </button>
              )}
              {track && <span className="voice-test__hint">{level > 0.08 ? 'Sounds good!' : 'Say something…'}</span>}
            </div>
            {err && <p className="form-errors" role="alert">{MIC_HELP[err]}</p>}
          </>
        ) : (
          <p className="muted">Spectators listen only. Press SPACE (or the big BUZZ button) to challenge during a live round.</p>
        )}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Not now</button>
          <button className="btn btn--primary" onClick={join} data-autofocus>
            {isSpeaker ? 'Join voice' : 'Join & listen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
