import { useEffect, useRef, useState } from 'react';
import { factCheckBlockReason, factCheckContextFromSnapshot, JURY_SEATS, type ClaimOption, type FactCheckView, type JuryMessage, type JuryModel, type RoomSnapshot } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { WarnIcon } from '../../components/icons';
import './factcheck.css';

export function FactCheckButton({ snapshot, myId, open, onOpen }: { snapshot: RoomSnapshot; myId: string | null; open: boolean; onOpen: () => void }) {
  const me = myId ? snapshot.participants.find((p) => p.id === myId) : undefined;
  if (!me || me.role !== 'speaker' || snapshot.status === 'ended') return null;
  if (snapshot.game.factCheckUsedIds.includes(me.id)) {
    return <button className="btn btn--sm factcheck-used" disabled>Fact check used</button>;
  }
  if (factCheckBlockReason(factCheckContextFromSnapshot(snapshot, myId))) return null;
  return (
    <button className={`btn btn--sm factcheck-btn ${open ? 'is-open' : ''}`} onClick={onOpen} type="button" aria-expanded={open}>
      <WarnIcon /> Fact check
    </button>
  );
}

export interface ClaimPanelState {
  open: boolean;
  loading: boolean;
  claims: ClaimOption[];
  speakerName: string | null;
  error: string | null;
  busy: boolean;
}

/**
 * Claim picker in the middle of the stage, visible only to the challenger. The room sees
 * "considering a challenge" next to them. Browsing changes nothing for the
 * room: the speaker keeps talking until "Challenge" is pressed.
 */
export function ClaimPanel({ state, onClose, onSubmit }: { state: ClaimPanelState; onClose: () => void; onSubmit: (claimId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected && !state.claims.some((c) => c.id === selected)) setSelected(null);
  }, [state.claims, selected]);
  const first = state.loading && state.claims.length === 0;

  return (
    <aside className="claim-panel tile" aria-label="Pick a claim to challenge">
      <header className="claim-panel__head">
        <div>
          <p className="label">Fact check</p>
          <h2 className="claim-panel__title">{state.speakerName ? `Challenge ${state.speakerName}` : 'Pick a claim'}</h2>
        </div>
        <div className="claim-panel__actions">
          <button className="btn btn--primary btn--sm" type="button" disabled={state.busy || !selected} onClick={() => selected && onSubmit(selected)}>
            {state.busy ? 'Challenging…' : 'Challenge'}
          </button>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close claim picker" disabled={state.busy}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </header>
      <p className="claim-panel__note">The round keeps going while you pick. The room sees you're considering a challenge. Nothing pauses until you press Challenge.</p>
      <div className="claim-panel__list" role="radiogroup" aria-label="Recent claims">
        {first && <p className="claim-panel__empty">Finding recent claims…</p>}
        {!first && state.error && <p className="claim-panel__empty claim-panel__empty--error">{state.error}</p>}
        {!first && !state.error && state.claims.length === 0 && (
          <p className="claim-panel__empty">No checkable claims from this speaker yet. New ones show up here as they talk.</p>
        )}
        {state.claims.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected === c.id}
            className={`claim ${selected === c.id ? 'is-selected' : ''}`}
            onClick={() => setSelected(c.id)}
            disabled={state.busy}
          >
            <span className="claim__radio" aria-hidden="true" />
            <span className="claim__text">“{c.text}”</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

const MODEL_NAME: Record<JuryModel, string> = {
  gemini: 'Gemini',
  gemini_skeptic: 'Gemini 2',
  groq: 'Groq',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

type Final = { text: string; detail: string | null; kind: 'ok' | 'bad' | 'mid' | 'wait' };

function finalOf(f: FactCheckView): Final {
  if (f.status === 'checking') return { text: f.juryPhase === 'deliberating' ? 'Deliberating' : 'Checking', detail: null, kind: 'wait' };
  if (f.unavailable) return { text: 'No decision', detail: 'The jury could not finish.', kind: 'mid' };
  const j = f.jury;
  const tally = j?.verdict ? `${Math.max(j.votesForCorrect, j.votesForIncorrect)}–${Math.min(j.votesForCorrect, j.votesForIncorrect)} · ${pct(j.juryConfidence)}` : null;
  if (f.verdict === 'INCORRECT' || f.verdict === 'CONTRADICTED') return { text: 'Claim is incorrect', detail: tally && `${tally} · challenge lands`, kind: 'bad' };
  if (f.verdict === 'CORRECT' || f.verdict === 'SUPPORTED') return { text: 'Claim stands', detail: tally && `${tally} · challenge fails`, kind: 'ok' };
  if (j && !j.verdict) return { text: 'Jury split', detail: 'No decision', kind: 'mid' };
  return { text: 'No decision', detail: null, kind: 'mid' };
}

function JurorMark({ model, size = 28 }: { model: JuryModel; size?: number }) {
  return (
    <span className={`juror-mark juror-mark--${model}`} style={{ width: size, height: size }} aria-hidden="true">
      {MODEL_NAME[model][0]}
    </span>
  );
}

/** Seat side in the conversation: the first seated juror on the left, the other on the right. */
function sideOf(model: JuryModel): 'left' | 'right' {
  return JURY_SEATS.indexOf(model) <= 0 ? 'left' : 'right';
}

/** Whole message typed out over at most this long (server waits about as long before the verdict). */
const TYPE_MAX_MS = 1500;
const TYPE_CHAR_MS = 14;

/** Reveals `text` a few characters at a time. `live` false shows it all at once (history, reconnects). */
function useTypewriter(text: string, live: boolean): string {
  const [shown, setShown] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (!live || matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(text.length);
    const total = Math.min(TYPE_MAX_MS, text.length * TYPE_CHAR_MS);
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const n = Math.ceil(text.length * Math.min(1, (t - start) / total));
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, live]);
  return text.slice(0, shown);
}

function Bubble({ msg, live }: { msg: JuryMessage; live: boolean }) {
  const side = sideOf(msg.model);
  const text = useTypewriter(msg.text, live);
  const typing = text.length < msg.text.length;
  return (
    <li className={`jmsg jmsg--${side}`}>
      <JurorMark model={msg.model} />
      <div className="jmsg__body">
        <div className="jmsg__meta">
          <span className="jmsg__name">{MODEL_NAME[msg.model]}</span>
          <span className={`jmsg__lean jmsg__lean--${msg.verdict === 'CORRECT' ? 'ok' : 'bad'}`}>
            {msg.verdict === 'CORRECT' ? 'Leans correct' : 'Leans incorrect'} · {pct(msg.confidence)}
          </span>
          {msg.changedVote && <span className="jmsg__changed">Changed vote</span>}
        </div>
        <p className="jmsg__text" aria-label={msg.text}>
          {text}
          {typing && <span className="jmsg__caret" aria-hidden="true" />}
        </p>
      </div>
    </li>
  );
}

function Thinking({ model }: { model: JuryModel }) {
  return (
    <li className={`jmsg jmsg--${sideOf(model)} jmsg--thinking`} aria-label={`${MODEL_NAME[model]} is thinking`}>
      <JurorMark model={model} />
      <div className="jmsg__body">
        <div className="jmsg__meta"><span className="jmsg__name">{MODEL_NAME[model]}</span><span className="jmsg__lean">thinking</span></div>
        <span className="typing" aria-hidden="true"><span /><span /><span /></span>
      </div>
    </li>
  );
}

/**
 * The jurors' conversation: each model's opening read, then their replies to each other,
 * then the verdict as the last line of the same thread.
 */
export function JuryThread({ check }: { check: FactCheckView }) {
  const log = useRef<HTMLOListElement>(null);
  const openings = check.thread.filter((m) => m.stage === 'opening');
  const replies = check.thread.filter((m) => m.stage === 'reply');
  const final = finalOf(check);
  const deliberating = check.juryPhase === 'deliberating' || replies.length > 0;
  const thinkingOpen = check.juryPhase !== 'deliberating' ? check.thinking : [];
  const thinkingReply = check.juryPhase === 'deliberating' ? check.thinking : [];
  // Messages already there when this card mounted (joined late, reconnect) show in full.
  const initial = useRef<Set<string> | null>(null);
  if (!initial.current) initial.current = new Set(check.thread.map((m) => m.id));
  const live = (m: JuryMessage) => !initial.current!.has(m.id);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [check.thread.length, check.thinking.length, check.status]);

  return (
    <ol className="jury" ref={log} aria-live="polite">
      <li className="jury__divider"><span>Independent reads</span></li>
      {openings.map((m) => <Bubble key={m.id} msg={m} live={live(m)} />)}
      {thinkingOpen.map((m) => <Thinking key={`t-${m}`} model={m} />)}
      {deliberating && <li className="jury__divider"><span>Reading each other</span></li>}
      {replies.map((m) => <Bubble key={m.id} msg={m} live={live(m)} />)}
      {thinkingReply.map((m) => <Thinking key={`r-${m}`} model={m} />)}
      {check.status === 'resolved' && (
        <li className={`jury__verdict jury__verdict--${final.kind}`}>
          <span className="jury__verdict-text">{final.text}</span>
          {final.detail && <span className="jury__verdict-detail">{final.detail}</span>}
        </li>
      )}
      {check.status === 'resolved' && (
        <li className="jury__resume" aria-hidden="true">Round resumes in a moment</li>
      )}
    </ol>
  );
}

/** Center-stage card for the active fact check: who challenged what, then the live jury. */
export function ChallengeCard({ check }: { check: FactCheckView }) {
  return (
    <article className="challenge tile" aria-label="Fact check in progress">
      <header className="challenge__head">
        <Avatar name={check.challengerName} size={36} />
        <div className="challenge__who">
          <span className="label">Fact check</span>
          <span><strong>{check.challengerName}</strong> challenged <strong>{check.speakerName}</strong></span>
        </div>
      </header>
      <blockquote className="challenge__claim">“{check.claim}”</blockquote>
      <JuryThread check={check} />
    </article>
  );
}

/** Left-bar history of this round's checks: one line each, result at the end. */
export function FactChat({ items }: { items: FactCheckView[] }) {
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <aside className="fact-chat tile" aria-label="Fact checks">
      <header className="fact-chat__head">Fact checks</header>
      <div className="fact-chat__log" ref={log}>
        {items.length === 0 && <p className="fact-chat__empty">Challenges show up here.</p>}
        {items.map((item) => {
          const final = finalOf(item);
          return (
            <article key={item.id} className="fact-msg">
              <p className="fact-msg__who">{item.challengerName} challenged {item.speakerName}</p>
              <p className="fact-msg__claim">“{item.claim}”</p>
              <p className={`fact-msg__final fact-msg__final--${final.kind}`}>
                {final.text}{final.kind === 'wait' && '…'}
                {final.detail && <span className="fact-msg__detail"> · {final.detail}</span>}
              </p>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
