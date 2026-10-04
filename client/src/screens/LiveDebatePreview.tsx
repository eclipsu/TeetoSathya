import { useEffect, useState } from 'react';

const FRAMES = ['speaking', 'claim', 'checking', 'verdict', 'ready'] as const;
type Frame = (typeof FRAMES)[number];

const PIPE = [
  { id: 'speaking', label: 'Speaking' },
  { id: 'challenged', label: 'Challenged' },
  { id: 'verdict', label: 'Verdict' },
] as const;

function pipeStep(frame: Frame): (typeof PIPE)[number]['id'] {
  if (frame === 'speaking' || frame === 'claim') return 'speaking';
  if (frame === 'checking') return 'challenged';
  return 'verdict';
}

/** Static sample of a fact check. Cycles slowly so the stakes are visible without reading a paragraph. */
export function LiveDebatePreview() {
  const [index, setIndex] = useState(3);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    setIndex(0);
    const timer = window.setInterval(() => setIndex((n) => (n + 1) % FRAMES.length), 2800);
    return () => window.clearInterval(timer);
  }, []);

  const frame = FRAMES[index];
  const step = pipeStep(frame);
  const checking = frame === 'checking';
  const showVerdict = frame === 'verdict' || frame === 'ready';
  const showQuote = frame !== 'speaking';

  return (
    <article className="board" aria-label="Example of a fact check">
      <header className="board__bar">
        <span>Live debate</span>
        <span className="board__live">Live</span>
      </header>

      <div className="board__scores">
        <div>
          <span className="board__side"><span className="dot dot--a" /> Team A</span>
          <strong>Cats</strong>
          <em>200 pts</em>
        </div>
        <div>
          <span className="board__side">Team B <span className="dot dot--b" /></span>
          <strong>Dogs</strong>
          <em>300 pts</em>
        </div>
      </div>

      <div className="board__floor">
        <div>
          <span className="board__kicker">Current floor</span>
          <strong>Sushil</strong>
          <span className="board__state">{frame === 'ready' ? 'Get ready' : 'Speaking'}</span>
        </div>
        <span className="board__time">{frame === 'ready' ? '10' : '01:24'}</span>
      </div>

      <blockquote className={showQuote ? '' : 'is-dim'}>
        {frame === 'ready' ? 'Ten seconds, then the clock resumes.' : '“The capital of Australia is Sydney.”'}
      </blockquote>

      <div className="board__check">
        <span className="board__kicker">Fact check</span>
        <div className="board__jury">
          <div>
            <span>Gemini</span>
            <strong className={showVerdict ? 'is-bad' : ''}>{checking ? 'Checking' : showVerdict ? 'Incorrect' : '—'}</strong>
            <em>{showVerdict ? '94%' : checking ? '…' : ''}</em>
          </div>
          <div>
            <span>Claude</span>
            <strong className={showVerdict ? 'is-bad' : ''}>{checking ? 'Checking' : showVerdict ? 'Incorrect' : '—'}</strong>
            <em>{showVerdict ? '91%' : checking ? '…' : ''}</em>
          </div>
        </div>
        <p className={`board__result ${showVerdict ? 'is-on' : ''}`}>
          {frame === 'ready' ? 'Challenge successful' : showVerdict ? 'Challenge successful · Team B +100' : checking ? 'Both models are reading the claim.' : 'Waiting on a challenge.'}
        </p>
      </div>

      <footer className="board__pipe" aria-hidden="true">
        {PIPE.map((item, i) => (
          <span key={item.id} className={step === item.id ? 'is-on' : ''}>
            {i > 0 && <span className="board__arrow">→</span>}
            {item.label}
          </span>
        ))}
      </footer>
    </article>
  );
}
