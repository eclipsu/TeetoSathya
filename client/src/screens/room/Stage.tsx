import type { RoomSnapshot } from '@teeto/shared';
import { Timer } from '../../components/Timer';
import { roundRemaining, useServerNow } from '../../state/clock';
import { HotSeatCard } from './HotSeatCard';

interface Props {
  snapshot: RoomSnapshot;
  myId: string | null;
  isHost: boolean;
  onDone: () => void;
}

/** Center stage: round timer on top, two hot-seat cards each with its own turn timer. */
export function Stage({ snapshot: s, myId, isHost, onDone }: Props) {
  const live = s.status === 'live';
  const now = useServerNow(live);
  const g = s.game;
  const roundMs = roundRemaining(s, now);
  const runningRound = live && g.roundEndsAt !== null;

  return (
    <section className={`stage ${live ? 'stage--live' : ''} ${g.buzz ? 'stage--buzz' : ''}`} aria-label="Stage">
      <div className="stage__round glass">
        <Timer ms={roundMs} running={runningRound} label={live ? (g.buzz ? 'Round · buzz' : g.paused ? 'Round · paused' : 'Round') : 'Round length'} size="lg" warn={live} />
        {!live && (
          <p className="stage__hint muted">
            {isHost ? 'Pick who opens with "Put in hot seat", then press Start.' : 'Waiting for the host to start.'}{' '}
            {s.settings.turnSeconds}s talk time per speaker.
          </p>
        )}
      </div>
      <div className="stage__seats">
        <HotSeatCard side={0} snapshot={s} now={now} myId={myId} onDone={onDone} />
        <div className="stage__vs" aria-hidden="true">VS</div>
        <HotSeatCard side={1} snapshot={s} now={now} myId={myId} onDone={onDone} />
      </div>
    </section>
  );
}
