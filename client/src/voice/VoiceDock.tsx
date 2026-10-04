import { useState } from 'react';
import { ConnectionChip } from '../components/ConnectionChip';
import { HeadphonesIcon, MicIcon, MicOffIcon, VolumeIcon, VolumeOffIcon } from '../components/icons';
import { LevelMeter } from './LevelMeter';
import { MIC_HELP, useMicLevel } from './useMicLevel';
import { useVoice } from './VoiceProvider';
import { VoiceJoinDialog } from './VoiceJoinDialog';
import './voice.css';

/** Header controls: Join voice, mic toggle (speakers), own level meter, master volume, status. */
export function VoiceDock({ isSpeaker, micReason }: { isSpeaker: boolean; micReason: string | null }) {
  const v = useVoice();
  const [dialog, setDialog] = useState(false);
  const myLevel = useMicLevel(v.localMicTrack);

  if (v.closed) {
    return (
      <div className="voice-dock">
        <ConnectionChip state="idle" label="Voice closed" />
      </div>
    );
  }

  if (v.status === 'idle' || v.status === 'error') {
    return (
      <div className="voice-dock">
        {v.status === 'error' && <ConnectionChip state="bad" label="Voice failed" />}
        <button className="btn btn--primary btn--sm" onClick={() => setDialog(true)}>
          <HeadphonesIcon width={16} height={16} /> <span className="btn__label">{v.status === 'error' ? 'Retry voice' : 'Join voice'}</span>
        </button>
        {v.error && <span className="sr-only" role="alert">{v.error}</span>}
        <VoiceJoinDialog open={dialog} isSpeaker={isSpeaker} onClose={() => setDialog(false)} onJoin={() => { setDialog(false); void v.join(); }} />
      </div>
    );
  }

  const chip =
    v.status === 'connected' ? { state: 'ok' as const, label: 'Voice' } :
    v.status === 'reconnecting' ? { state: 'warn' as const, label: 'Reconnecting…' } :
    { state: 'idle' as const, label: 'Joining…' };

  const micTitle = !v.canPublish ? micReason ?? 'Mic closed' : v.wantMic ? 'Mute mic' : 'Unmute mic';

  return (
    <div className="voice-dock">
      <ConnectionChip {...chip} />
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
