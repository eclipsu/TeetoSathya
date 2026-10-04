import { useRef } from 'react';
import type { GameReview, PlayerReview, ReviewLine, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { formatClock } from '../../state/clock';
import { JurorMark, MODEL_NAME, useTypewriter } from './FactCheck';

/** What a juror said, typed out in step with the voice. */
function Said({ line, live, speaking }: { line: ReviewLine; live: boolean; speaking: boolean }) {
  const text = useTypewriter(line.text, live, line.audioMs);
  return (
    <p className={`rplayer__said ${speaking ? 'is-speaking' : ''}`}>
      <JurorMark model={line.model} size={20} />
      <span className="rplayer__said-text" aria-label={`${MODEL_NAME[line.model]}: ${line.text}`}>{text}</span>
    </p>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'up' | 'down' }) {
  return (
    <li className={`rstat ${tone ? `rstat--${tone}` : ''}`}>
      <span className="rstat__value">{value}</span>
      <span className="rstat__label">{label}</span>
    </li>
  );
}

function PlayerRow({ p, line, live, speaking, waiting }: { p: PlayerReview; line?: ReviewLine; live: boolean; speaking: boolean; waiting: boolean }) {
  return (
    <li className={`rplayer ${speaking ? 'is-speaking' : ''}`}>
      <div className="rplayer__top">
        <Avatar name={p.name} size={32} />
        <span className="rplayer__name">{p.name}</span>
        {p.outs > 0 && <span className="rplayer__out">Out {p.outs}×</span>}
      </div>
      <ul className="rplayer__stats">
        <Stat value={p.checked ? `${p.stood}/${p.checked}` : '—'} label={p.checked ? 'claims held' : 'not challenged'} />
        <Stat value={p.challenges ? `${p.landed}/${p.challenges}` : '—'} label="challenges" />
        <Stat value={p.points > 0 ? `+${p.points}` : String(p.points)} label="points" tone={p.points > 0 ? 'up' : p.points < 0 ? 'down' : undefined} />
        <Stat value={formatClock(p.talkMs)} label="talked" />
      </ul>
      {p.leanedOn && <p className="rplayer__lean">Leaned on <q>{p.leanedOn}</q></p>}
      {line
        ? <Said line={line} live={live} speaking={speaking} />
        : waiting && <span className="typing rplayer__typing" aria-hidden="true"><span /><span /><span /></span>}
    </li>
  );
}

/**
 * End-of-game review: each side's players with their numbers, and what the jurors said about each
 * one as it is read out. The last line, the result, closes it as a banner.
 */
export function JuryReview({ review, sides, speakingId }: { review: GameReview; sides: [string, string]; speakingId: string | null }) {
  // Lines already there when the summary opened (late join, reload) show in full.
  const initial = useRef<Set<string> | null>(null);
  if (!initial.current) initial.current = new Set(review.lines.map((l) => l.id));
  const live = (l: ReviewLine) => !initial.current!.has(l.id);
  // Lines come in player order, then one result line.
  const lineFor = (p: PlayerReview) => review.lines[review.players.indexOf(p)];
  const verdict = review.lines.length > review.players.length ? review.lines[review.lines.length - 1] : undefined;
  const status = review.status === 'writing' ? 'Reviewing the game…' : review.status === 'speaking' ? 'Speaking' : 'Done';

  return (
    <section className="review" aria-label="Jury review">
      <header className="review__head">
        <h3 className="review__title">Jury review</h3>
        <span className={`review__status review__status--${review.status}`}>{status}</span>
      </header>
      <div className="review__teams">
        {([0, 1] as TeamIndex[]).map((team) => {
          const players = review.players.filter((p) => p.team === team);
          if (!players.length) return null;
          return (
            <div key={team} className={`review__team review__team--${team}`}>
              <h4 className="review__side"><span className={`dot dot--${team === 0 ? 'a' : 'b'}`} />{sides[team]}</h4>
              <ul className="review__players">
                {players.map((p) => {
                  const line = lineFor(p);
                  return <PlayerRow key={p.id} p={p} line={line} live={!!line && live(line)} speaking={!!line && line.id === speakingId} waiting={review.status !== 'done'} />;
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {verdict && (
        <p className={`review__verdict ${verdict.id === speakingId ? 'is-speaking' : ''}`}>
          <JurorMark model={verdict.model} size={22} />
          <span>{verdict.text}</span>
        </p>
      )}
    </section>
  );
}
