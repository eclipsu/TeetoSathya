import type { ParticipantView, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { levelStyle, useSpeaking } from '../../voice/useSpeaking';

interface SeatSlotProps {
  seat: number;
  team: TeamIndex;
  participant: ParticipantView | undefined;
  isMe: boolean;
  inHotSeat: boolean;
  /** Has the claim picker open: about to challenge the speaker. */
  considering?: boolean;
  /** Caught out by a challenge: sits out the rest of this round. */
  out?: boolean;
  /** Present when the viewer may take this open seat. */
  onTake?: () => void;
  /** Present for the host while live: put this speaker in the hot seat. */
  onHotSeat?: () => void;
}

export function SeatSlot(props: SeatSlotProps) {
  return props.participant ? <FilledSeat {...props} participant={props.participant} /> : <EmptySeat {...props} />;
}

function EmptySeat({ seat, onTake }: SeatSlotProps) {
  return (
    <li className="seat seat--empty">
      {onTake ? (
        <button className="seat__open" onClick={onTake}>
          <span className="seat__num">{seat}</span> Open seat <span className="seat__take">Take seat</span>
        </button>
      ) : (
        <span className="seat__open seat__open--static">
          <span className="seat__num">{seat}</span> Open seat
        </span>
      )}
    </li>
  );
}

function FilledSeat({ team, participant: p, isMe, inHotSeat, considering, out, onHotSeat }: SeatSlotProps & { participant: ParticipantView }) {
  const { speaking, level } = useSpeaking(p.id);
  return (
    <li
      className={`seat seat--filled seat--team-${team} ${inHotSeat ? 'seat--hot' : ''} ${p.connected ? '' : 'seat--away'} ${speaking ? 'is-speaking' : ''} ${out ? 'seat--out' : ''}`}
      data-participant={p.id}
      style={levelStyle(level)}
    >
      <Avatar name={p.username} size={36} speaking={speaking} />
      <div className="seat__info">
        <span className="seat__name">
          {p.username}
          {isMe && <span className="tag tag--me">You</span>}
        </span>
        <span className="seat__sub">
          {p.isHost && <span className="tag tag--host">Host</span>}
          <span className={`seat__status ${inHotSeat ? 'seat__status--hot' : ''}`}><span className="dot" />{out ? 'Out this round' : !p.connected ? 'Reconnecting…' : inHotSeat ? 'Hot seat' : 'Ready'}</span>
          {considering && p.connected && <span className="considering">Considering a challenge</span>}
        </span>
      </div>
      <span className="speak-dot" aria-hidden="true" />
      {onHotSeat && !inHotSeat && !out && (
        <button className="btn btn--ghost btn--sm seat__action" onClick={onHotSeat}>Put in hot seat</button>
      )}
    </li>
  );
}
