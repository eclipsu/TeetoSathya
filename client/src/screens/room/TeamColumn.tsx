import type { ParticipantView, RoomSnapshot, TeamIndex } from '@teeto/shared';
import { SeatSlot } from './SeatSlot';

interface TeamColumnProps {
  team: TeamIndex;
  snapshot: RoomSnapshot;
  myId: string | null;
  canTakeSeat: boolean;
  onTakeSeat: (team: TeamIndex) => void;
  onHotSeat?: (team: TeamIndex, participantId: string) => void;
}

export function TeamColumn({ team, snapshot, myId, canTakeSeat, onTakeSeat, onHotSeat }: TeamColumnProps) {
  const speakers = snapshot.participants.filter((p) => p.role === 'speaker' && p.team === team);
  const bySeat = new Map<number, ParticipantView>(speakers.map((p) => [p.seatOrder ?? 0, p]));
  const max = snapshot.settings.speakersPerTeamMax;
  const hot = snapshot.game.hotSeat[team];

  return (
    <section className={`team team--${team} tile`} aria-label={`Team ${snapshot.sides[team]}`}>
      <header className="team__head">
        <span className={`dot dot--${team === 0 ? 'a' : 'b'}`} aria-hidden="true" />
        <div className="team__title">
          <h2 className="team__name">{snapshot.sides[team]}</h2>
          <span className="team__count">{speakers.length} / {max} seats</span>
        </div>
      </header>
      <ol className="team__seats">
        {Array.from({ length: max }, (_, i) => i + 1).map((seat) => {
          const p = bySeat.get(seat);
          return (
            <SeatSlot
              key={p ? p.id : `empty-${seat}`}
              seat={seat}
              team={team}
              participant={p}
              isMe={!!p && p.id === myId}
              inHotSeat={!!p && p.id === hot}
              considering={!!p && snapshot.game.consideringIds.includes(p.id)}
              onTake={canTakeSeat ? () => onTakeSeat(team) : undefined}
              onHotSeat={p && onHotSeat ? () => onHotSeat(team, p.id) : undefined}
            />
          );
        })}
      </ol>
    </section>
  );
}
