import type { ParticipantView, RoomSnapshot, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { MicIcon, MicOffIcon } from '../../components/icons';
import { Timer } from '../../components/Timer';
import { sideRemaining } from '../../state/clock';
import { LevelMeter } from '../../voice/LevelMeter';
import { levelStyle, useSpeaking } from '../../voice/useSpeaking';

interface Props {
  side: TeamIndex;
  snapshot: RoomSnapshot;
  now: number;
  myId: string | null;
  onDone?: () => void;
}

/** Turn timer + big hot-seat speaker card for one side. */
export function HotSeatCard({ side, snapshot: s, now, myId, onDone }: Props) {
  const g = s.game;
  const p: ParticipantView | undefined = s.participants.find((x) => x.id === g.hotSeat[side]);
  const live = s.status === 'live';
  const active = live && g.activeSide === side;
  const holdsFloor = active && !g.paused && !g.buzz;
  const { speaking, level } = useSpeaking(p?.id);
  const ms = sideRemaining(s, side, now);
  const isMe = !!p && p.id === myId;

  const state = !live ? 'Lobby' : !active ? 'Waiting' : g.buzz ? 'Challenged' : g.paused ? 'Paused' : 'Speaking';

  return (
    <div className={`hot hot--team-${side} ${active ? 'is-active' : live ? 'is-idle' : ''} ${speaking ? 'is-speaking' : ''}`} style={levelStyle(level)}>
      <Timer ms={ms} running={holdsFloor} label={`${s.sides[side]} clock`} warn={live} />
      <article className="hot__card" aria-label={`${s.sides[side]} hot seat`}>
        <span className="hot__bar" aria-hidden="true" />
        {holdsFloor && <span className="hot__live">LIVE</span>}
        {p ? (
          <>
            <div className="hot__avatar">
              <Avatar name={p.username} size={120} speaking={speaking} />
            </div>
            <h3 className="hot__name">
              {p.username}
              {isMe && <span className="tag tag--me">You</span>}
            </h3>
            <p className="hot__state">{state}{!p.connected && ' · reconnecting…'}</p>
            <div className="hot__mic" aria-hidden="true">
              {holdsFloor || !live ? <MicIcon width={16} height={16} /> : <MicOffIcon width={16} height={16} />}
              <LevelMeter level={level} segments={10} />
            </div>
            {isMe && holdsFloor && onDone && (
              <button className="btn btn--primary hot__done" onClick={onDone}>
                I'm done <kbd>Space</kbd>
              </button>
            )}
          </>
        ) : (
          <div className="hot__empty">
            <span className="hot__empty-ring" />
            <p className="muted">No speaker yet</p>
          </div>
        )}
      </article>
    </div>
  );
}
