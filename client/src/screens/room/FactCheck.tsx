import { useEffect, useRef, useState, type ReactNode } from 'react';
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
      <WarnIcon /> Fact check <kbd className="factcheck-btn__key">Space</kbd>
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

export const MODEL_NAME: Record<JuryModel, string> = {
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
  if (f.status === 'tiebreak') return { text: 'Jury split', detail: 'the host decides', kind: 'wait' };
  if (f.decidedByHost) {
    const landed = f.verdict === 'INCORRECT' || f.verdict === 'CONTRADICTED';
    return { text: landed ? 'Claim is incorrect' : 'Claim stands', detail: `jury split · host ruled · challenge ${landed ? 'lands' : 'fails'}`, kind: landed ? 'bad' : 'ok' };
  }
  if (f.unavailable) return { text: 'No decision', detail: 'The jury could not finish.', kind: 'mid' };
  const j = f.jury;
  const tally = j?.verdict ? `${Math.max(j.votesForCorrect, j.votesForIncorrect)}–${Math.min(j.votesForCorrect, j.votesForIncorrect)} · ${pct(j.juryConfidence)}` : null;
  // Every juror found the claim off the room topic: it counts as incorrect.
  if (j?.offTopic) return { text: 'Different and incorrect', detail: tally && `${tally} · off topic · challenge lands`, kind: 'bad' };
  if (f.verdict === 'INCORRECT' || f.verdict === 'CONTRADICTED') return { text: 'Claim is incorrect', detail: tally && `${tally} · challenge lands`, kind: 'bad' };
  if (f.verdict === 'CORRECT' || f.verdict === 'SUPPORTED') return { text: 'Claim stands', detail: tally && `${tally} · challenge fails`, kind: 'ok' };
  if (j && !j.verdict) return { text: 'Jury split', detail: 'No decision', kind: 'mid' };
  return { text: 'No decision', detail: null, kind: 'mid' };
}

export function JurorMark({ model, size = 28 }: { model: JuryModel; size?: number }) {
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

/** Text-only messages type out over at most this long (server waits about as long before the verdict). */
const TYPE_MAX_MS = 1500;
const TYPE_CHAR_MS = 14;

/**
 * Reveals `text` a few characters at a time. With `durationMs` (the spoken audio) it types in
 * step with the voice. `live` false shows it all at once (history, reconnects).
 */
export function useTypewriter(text: string, live: boolean, durationMs: number | null): string {
  const [shown, setShown] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (!live || matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(text.length);
    const total = durationMs ? durationMs * 0.92 : Math.min(TYPE_MAX_MS, text.length * TYPE_CHAR_MS);
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const n = Math.ceil(text.length * Math.min(1, (t - start) / total));
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, live, durationMs]);
  return text.slice(0, shown);
}

function Bubble({ msg, live, speaking }: { msg: JuryMessage; live: boolean; speaking: boolean }) {
  const side = sideOf(msg.model);
  const text = useTypewriter(msg.text, live, msg.audioMs ?? null);
  const typing = text.length < msg.text.length;
  return (
    <li className={`jmsg jmsg--${side} ${speaking ? 'is-speaking' : ''}`}>
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
        {!typing && msg.sources?.length > 0 && <Sources list={msg.sources} />}
      </div>
    </li>
  );
}

/** Named sources (from the juror's knowledge, not links). */
function Sources({ list, label = 'Source' }: { list: string[]; label?: string }) {
  return (
    <p className="jsources">
      <span className="jsources__label">{label}</span>
      {list.map((s) => <span key={s} className="jsources__item">{s}</span>)}
    </p>
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
export function JuryThread({ check, speakingId = null }: { check: FactCheckView; speakingId?: string | null }) {
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
      {openings.map((m) => <Bubble key={m.id} msg={m} live={live(m)} speaking={m.id === speakingId} />)}
      {thinkingOpen.map((m) => <Thinking key={`t-${m}`} model={m} />)}
      {deliberating && <li className="jury__divider"><span>Reading each other</span></li>}
      {replies.map((m) => <Bubble key={m.id} msg={m} live={live(m)} speaking={m.id === speakingId} />)}
      {thinkingReply.map((m) => <Thinking key={`r-${m}`} model={m} />)}
      {check.status === 'resolved' && (
        <li className={`jury__verdict jury__verdict--${final.kind}`}>
          <span className="jury__verdict-text">{final.text}</span>
          {final.detail && <span className="jury__verdict-detail">{final.detail}</span>}
          {(() => {
            // The decision, backed by the sources the jurors named (deduplicated).
            const all = [...new Set(check.thread.flatMap((m) => m.sources ?? []))].filter((s) => !/^general knowledge$/i.test(s));
            return all.length ? <Sources list={all.slice(0, 4)} label="Based on" /> : null;
          })()}
          <Points delta={check.scoreDelta} />
        </li>
      )}
      {check.status === 'resolved' && (
        <li className="jury__resume" aria-hidden="true">Round resumes in a moment</li>
      )}
    </ol>
  );
}

/** Center-stage card for the active fact check: who challenged what, then the live jury. */
export interface TiebreakControls {
  /** This viewer is the host: show the two decision buttons. */
  isHost: boolean;
  hostName: string | null;
  onDecide: (verdict: 'CORRECT' | 'INCORRECT') => void;
  /** Push-to-talk held (P key or the button). */
  talking: boolean;
  onTalk: (held: boolean) => void;
}

/** Jurors split: everyone may hold P to argue; the AI isn't listening; the host rules. */
function Tiebreak({ c }: { c: TiebreakControls }) {
  const hold = (held: boolean) => (e: React.PointerEvent) => { e.preventDefault(); c.onTalk(held); };
  return (
    <div className="tiebreak" role="region" aria-label="Jury tie-break">
      <p className="tiebreak__title">The jury split</p>
      <p className="tiebreak__note">
        Hold <kbd>P</kbd> to argue your case. The AI isn't listening. {c.isHost ? 'You decide.' : `${c.hostName ?? 'The host'} decides.`}
      </p>
      <div className="tiebreak__actions">
        <button
          type="button"
          className={`btn btn--sm tiebreak__talk ${c.talking ? 'is-on' : ''}`}
          onPointerDown={hold(true)}
          onPointerUp={hold(false)}
          onPointerLeave={() => c.talking && c.onTalk(false)}
          onPointerCancel={() => c.onTalk(false)}
          aria-pressed={c.talking}
        >
          {c.talking ? 'Talking…' : 'Hold to talk'}
        </button>
        {c.isHost && (
          <>
            <button type="button" className="btn btn--sm tiebreak__stands" onClick={() => c.onDecide('CORRECT')}>Claim stands</button>
            <button type="button" className="btn btn--sm tiebreak__false" onClick={() => c.onDecide('INCORRECT')}>Claim is false</button>
          </>
        )}
      </div>
    </div>
  );
}

export function ChallengeCard({ check, speakingId = null, tiebreak }: { check: FactCheckView; speakingId?: string | null; tiebreak?: TiebreakControls }) {
  return (
    <article className={`challenge tile ${check.status === 'tiebreak' ? 'is-tiebreak' : ''}`} aria-label="Fact check in progress">
      <header className="challenge__head">
        <Avatar name={check.challengerName} size={36} />
        <div className="challenge__who">
          <span className="label">Fact check</span>
          <span><strong>{check.challengerName}</strong> challenged <strong>{check.speakerName}</strong></span>
        </div>
      </header>
      <blockquote className="challenge__claim">“{check.claim}”</blockquote>
      <JuryThread check={check} speakingId={speakingId} />
      {check.status === 'tiebreak' && tiebreak && <Tiebreak c={tiebreak} />}
    </article>
  );
}

/** Points this check gave the challenger's team. Nothing while running or for no decision. */
function Points({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return null;
  return <span className={`fact-points fact-points--${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`} points</span>;
}

/** Left-bar history of this round's checks: one line each, result at the end. */
export function FactChat({ items, action, live = false }: { items: FactCheckView[]; action?: ReactNode; live?: boolean }) {
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <section className="fact-chat tile" aria-label="Fact checks">
      <header className="fact-chat__head">
        <span className="fact-chat__title">Fact checks{items.length > 0 && <span className="fact-chat__count">{items.length}</span>}</span>
        {action}
      </header>
      <div className="fact-chat__log" ref={log}>
        {items.length === 0 && (
          <p className="fact-chat__empty">
            {live
              ? 'No challenges yet. When the other side is speaking, press Space or Fact check to challenge one of their claims.'
              : 'No challenges this round.'}
          </p>
        )}
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
              <Points delta={item.scoreDelta} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
