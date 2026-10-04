import type { RoomSnapshot, RoundWinner, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { Confetti } from '../../components/Confetti';
import { formatClock } from '../../state/clock';
import { FactChat } from './FactCheck';
import { JuryReview } from './JuryReview';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Winning side's color, weighted, plus the neutral text color. */
function confettiColors(side: TeamIndex): string[] {
  const team = cssVar(side === 0 ? '--team-a' : '--team-b') || '#4f8cff';
  const text = cssVar('--text') || '#e8eaed';
  return [team, team, team, text, cssVar('--text-dim') || '#9aa0a6'];
}

interface Props {
  snapshot: RoomSnapshot;
  /** Review line being read aloud right now. */
  speakingId?: string | null;
  isHost: boolean;
  onPickWinner: (winner: RoundWinner) => void;
}

/** End-of-round summary: the winner and score, then who spoke and how much of their talk time they used. */
export function Summary({ snapshot: s, isHost, onPickWinner, speakingId = null }: Props) {
  const budget = s.settings.turnSeconds * 1000;
  const roundUsed = s.settings.roundSeconds * 1000 - (s.game.roundRemainingMs ?? 0);
  const { scores: score, winner } = s.game;
  const won = winner === 0 || winner === 1 ? winner : null;
  return (
    <section className="summary tile" aria-labelledby="summary-title">
      {won !== null && <Confetti key={won} colors={confettiColors(won)} />}
      <header className="summary__head">
        <p className="summary__kicker">Game over</p>
        <h2 id="summary-title" className="summary__topic">{s.topic}</h2>
        <p className="muted">Round time used: {formatClock(Math.max(0, roundUsed))}</p>
      </header>
      <div className={`summary__result ${won !== null ? `summary__result--team-${won}` : ''}`} role="status">
        <div className="summary__score" aria-label={`${s.sides[0]} ${score[0]}, ${s.sides[1]} ${score[1]}`}>
          <span className="summary__score-side"><span className="dot dot--a" />{s.sides[0]}</span>
          <span className="summary__score-num">{score[0]}<span className="summary__score-dash">–</span>{score[1]}</span>
          <span className="summary__score-side"><span className="dot dot--b" />{s.sides[1]}</span>
        </div>
        {won !== null && <p className="summary__winner">{s.sides[won]} wins</p>}
        {winner === 'draw' && <p className="summary__winner summary__winner--draw">Draw</p>}
        {winner === null && (
          isHost ? (
            <div className="summary__tie">
              <p className="muted">Tied on fact-check points. Pick the winner.</p>
              <div className="summary__tie-actions">
                <button className="btn btn--sm" onClick={() => onPickWinner(0)}><span className="dot dot--a" />{s.sides[0]}</button>
                <button className="btn btn--sm" onClick={() => onPickWinner(1)}><span className="dot dot--b" />{s.sides[1]}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => onPickWinner('draw')}>Draw</button>
              </div>
            </div>
          ) : (
            <p className="muted summary__tie-wait">Tied on fact-check points. Waiting for the host to pick the winner.</p>
          )
        )}
        <p className="summary__rule">A challenge that lands is +100 for the challenger's side. One that fails is −50 for the challenger's side.</p>
      </div>
      {s.game.review && <JuryReview review={s.game.review} sides={s.sides} speakingId={speakingId} />}
      {s.game.roundLog.length > 0 && (
        <ol className="summary__rounds" aria-label="Rounds">
          {s.game.roundLog.map((r) => (
            <li key={r.number} className="summary__round">
              <span className="summary__round-num">Round {r.number}</span>
              <span className="summary__round-claim">{r.claim ? `“${r.claim}”` : 'No opening claim'}</span>
              <span className="summary__round-meta">
                {r.openerName ? `${r.openerName} opened for ${s.sides[r.openingSide]}` : `${s.sides[r.openingSide]} opened`}
                {' · '}
                {r.endedBy === 'out' && r.outTeam !== null ? `${s.sides[r.outTeam]} ran out of speakers` : r.endedBy === 'time' ? 'time ran out' : 'ended by the host'}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="summary__teams">
        {([0, 1] as const).map((side) => {
          const speakers = s.participants
            .filter((p) => p.role === 'speaker' && p.team === side)
            .sort((a, b) => b.timeUsedMs - a.timeUsedMs);
          const total = speakers.reduce((acc, p) => acc + p.timeUsedMs, 0);
          return (
            <div key={side} className={`summary__team summary__team--${side} ${won === side ? 'is-winner' : won !== null ? 'is-loser' : ''}`}>
              <h3>
                <span className="summary__side">
                  <span className={`dot dot--${side === 0 ? 'a' : 'b'}`} />{s.sides[side]}
                  {won === side && <span className="summary__badge">Winner</span>}
                </span>
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
