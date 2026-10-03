import type { ParticipantView, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';

interface SeatSlotProps {
  seat: number;
  team: TeamIndex;
  participant: ParticipantView | undefined;
  isMe: boolean;
  inHotSeat: boolean;
  /** Present when the viewer may take this open seat. */
  onTake?: () => void;
  /** Present for the host while live: put this speaker in the hot seat. */
  onHotSeat?: () => void;
}

export function SeatSlot({ seat, team, participant: p, isMe, inHotSeat, onTake, onHotSeat }: SeatSlotProps) {
  if (!p) {
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
  return (
    <li
      className={`seat seat--filled seat--team-${team} ${inHotSeat ? 'seat--hot' : ''} ${p.connected ? '' : 'seat--away'}`}
      data-participant={p.id}
    >
      <Avatar name={p.username} size={40} />
      <div className="seat__info">
        <span className="seat__name">
          {p.username}
          {isMe && <span className="tag tag--me">You</span>}
        </span>
        <span className="seat__sub">
          {p.isHost && <span className="tag tag--host">Host</span>}
          {inHotSeat && <span className="tag tag--hot">Hot seat</span>}
          {!p.connected && <span className="tag tag--away">Reconnecting…</span>}
        </span>
      </div>
      <span className="speak-dot" aria-hidden="true" />
      {onHotSeat && !inHotSeat && (
        <button className="btn btn--ghost btn--sm seat__action" onClick={onHotSeat}>Put in hot seat</button>
      )}
    </li>
  );
}
