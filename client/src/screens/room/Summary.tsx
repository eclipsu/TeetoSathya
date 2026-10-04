import type { RoomSnapshot } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { formatClock } from '../../state/clock';
import { FactChat } from './FactCheck';

/** End-of-round summary: who spoke and how much of their talk time they used. */
export function Summary({ snapshot: s }: { snapshot: RoomSnapshot }) {
  const budget = s.settings.turnSeconds * 1000;
  const roundUsed = s.settings.roundSeconds * 1000 - (s.game.roundRemainingMs ?? 0);
  return (
    <section className="summary glass" aria-labelledby="summary-title">
      <header className="summary__head">
        <p className="summary__kicker">Round over</p>
        <h2 id="summary-title" className="summary__topic">{s.topic}</h2>
        <p className="muted">Round time used: {formatClock(Math.max(0, roundUsed))}</p>
      </header>
      <div className="summary__teams">
        {([0, 1] as const).map((side) => {
          const speakers = s.participants
            .filter((p) => p.role === 'speaker' && p.team === side)
            .sort((a, b) => b.timeUsedMs - a.timeUsedMs);
          const total = speakers.reduce((acc, p) => acc + p.timeUsedMs, 0);
          return (
            <div key={side} className={`summary__team summary__team--${side}`}>
              <h3>
                <span className={`side-pill side-pill--${side === 0 ? 'a' : 'b'}`}>{s.sides[side]}</span>
                <span className="summary__total">{formatClock(total)} total</span>
              </h3>
              <ul>
                {speakers.length === 0 && <li className="muted">No speakers.</li>}
                {speakers.map((p) => (
                  <li key={p.id} className="summary__row">
                    <Avatar name={p.username} size={32} />
                    <span className="summary__name">{p.username}</span>
                    <span className="summary__bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, (p.timeUsedMs / budget) * 100)}%` }} />
                    </span>
                    <span className="summary__time">{p.timeUsedMs > 0 ? formatClock(p.timeUsedMs) : "didn't speak"}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <FactChat items={s.game.factChecks} />
    </section>
  );
}
