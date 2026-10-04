import type { ParticipantView, RoomSnapshot, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
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
  /** A challenge holds the middle of the stage: shrink to make room. */
  compact?: boolean;
}

/** Turn-timer pill above the hot-seat speaker card for one side. */
export function HotSeatCard({ side, snapshot: s, now, myId, onDone, compact = false }: Props) {
  const g = s.game;
  const live = s.status === 'live';
  // Before the start, preview who opens: the host's pick, else the first seat (what Start picks).
  const p: ParticipantView | undefined = s.participants.find((x) => x.id === g.hotSeat[side]) ??
    (s.status === 'lobby'
      ? s.participants.filter((x) => x.role === 'speaker' && x.team === side).sort((a, b) => (a.seatOrder ?? 99) - (b.seatOrder ?? 99))[0]
      : undefined);
  const active = live && g.activeSide === side;
  const holdsFloor = active && !g.paused && !g.buzz && !g.factCheck;
  const { speaking, level } = useSpeaking(p?.id);
  const ms = sideRemaining(s, side, now);
  const isMe = !!p && p.id === myId;

  const considering = !!p && p.connected && g.consideringIds.includes(p.id);
  const challenged = !!p && ((!!g.buzz && g.buzz.challengedParticipantId === p.id) || (!!g.factCheck && g.factCheck.speakerId === p.id));
  const state = !live || holdsFloor
    ? null
    : challenged
      ? 'Challenged'
      : !active
        ? null
        : g.buzz
          ? 'Up next'
          : 'Paused';

  return (
    <div
      className={`hot hot--team-${side} ${active ? 'is-active' : live ? 'is-idle' : ''} ${speaking ? 'is-speaking' : ''} ${challenged ? 'is-challenged' : ''} ${compact ? 'is-compact' : ''}`}
      style={levelStyle(level)}
    >
      <Timer ms={ms} running={holdsFloor} label={`${s.sides[side]} clock`} warn={live} />
      <article className="hot__card tile" aria-label={`${s.sides[side]} hot seat`}>
        {p ? (
          <>
            <div className="hot__avatar">
              <Avatar name={p.username} size={compact ? 56 : 88} speaking={speaking} />
            </div>
            {holdsFloor && <span className="hot__live">Live</span>}
            {state && <span className="hot__state">{state}</span>}
            <h3 className="hot__name">
              {p.username}
              {isMe && <span className="tag tag--me">You</span>}
            </h3>
            <span className="hot__side"><span className="dot" />{s.sides[side]}{!p.connected && ' · reconnecting…'}</span>
            {considering && <span className="considering">Considering a challenge</span>}
            {holdsFloor && (
              <div className="hot__mic" aria-hidden="true">
                <LevelMeter level={level} segments={10} />
              </div>
            )}
            {isMe && holdsFloor && onDone && (
              <button className="btn btn--primary btn--sm hot__done" onClick={onDone}>
                I'm done <kbd>Space</kbd>
              </button>
            )}
          </>
        ) : (
          <div className="hot__empty">
            <span className="hot__empty-ring" />
            <p className="muted">No speaker yet</p>
            <span className="hot__side"><span className="dot" />{s.sides[side]}</span>
          </div>
        )}
      </article>
    </div>
  );
}
