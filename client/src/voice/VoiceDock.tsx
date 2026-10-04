import { ConnectionChip } from '../components/ConnectionChip';
import { MicIcon, MicOffIcon, VolumeIcon, VolumeOffIcon } from '../components/icons';
import { LevelMeter } from './LevelMeter';
import { MIC_HELP, useMicLevel } from './useMicLevel';
import { useVoice } from './VoiceProvider';
import './voice.css';

/** Header controls: mic toggle (speakers), own level meter, master volume, status. */
export function VoiceDock({ isSpeaker, micReason }: { isSpeaker: boolean; micReason: string | null }) {
  const v = useVoice();
  const myLevel = useMicLevel(v.localMicTrack);

  if (v.closed) {
    return (
      <div className="voice-dock">
        <ConnectionChip state="idle" label="Voice closed" />
      </div>
    );
  }

  const chip =
    v.status === 'connected' ? { state: 'ok' as const, label: 'Voice' } :
    v.status === 'reconnecting' ? { state: 'warn' as const, label: 'Reconnecting…' } :
    v.status === 'error' ? { state: 'bad' as const, label: 'Voice failed' } :
    { state: 'idle' as const, label: 'Joining…' };

  const micTitle = !v.canPublish ? micReason ?? 'Mic closed' : v.wantMic ? 'Mute mic' : 'Unmute mic';

  return (
    <div className="voice-dock">
      <ConnectionChip {...chip} />
      {v.status === 'error' && (
        <button className="btn btn--primary btn--sm" onClick={() => void v.join()}>Retry</button>
      )}
      {v.error && <span className="sr-only" role="alert">{v.error}</span>}
      {v.audioBlocked && (
        <button className="btn btn--sm btn--danger" onClick={v.unlockAudio}>Enable audio</button>
      )}
      {isSpeaker && (
        <div className={`mic-ctl ${v.micLive ? 'is-live' : ''} ${!v.canPublish ? 'is-locked' : ''}`}>
          <button
            className="icon-btn mic-ctl__btn"
            onClick={v.toggleMic}
            aria-pressed={v.wantMic}
            aria-label={micTitle}
            title={micTitle}
          >
            {v.micLive ? <MicIcon /> : <MicOffIcon />}
          </button>
          <LevelMeter level={v.micLive ? myLevel : 0} segments={6} className="mic-ctl__meter" />
        </div>
      )}
      <label className="volume" title="Voice volume">
        {v.volume === 0 ? <VolumeOffIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
        <span className="sr-only">Voice volume</span>
        <input type="range" min={0} max={1} step={0.05} value={v.volume} onChange={(e) => v.setVolume(Number(e.target.value))} />
      </label>
      {v.micError && (
        <div className="mic-help" role="alert">
          <strong>Mic blocked.</strong> {MIC_HELP[v.micError]}
        </div>
      )}
    </div>
  );
}
