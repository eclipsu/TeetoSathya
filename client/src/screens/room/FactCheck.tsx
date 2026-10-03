import { useEffect, useState } from 'react';
import { factCheckBlockReason, factCheckContextFromSnapshot, JURY_SEATS, type ClaimOption, type FactCheckView, type JuryBinary, type JuryModel, type JuryPhase, type JuryResult, type JuryVote, type RoomSnapshot } from '@teeto/shared';
import { Modal } from '../../components/Modal';
import './factcheck.css';

export function FactCheckButton({ snapshot, myId, onOpen }: { snapshot: RoomSnapshot; myId: string | null; onOpen: () => void }) {
  const me = myId ? snapshot.participants.find((p) => p.id === myId) : undefined;
  if (!me || me.role !== 'speaker' || snapshot.status === 'ended') return null;
  if (snapshot.game.factCheckUsedIds.includes(me.id)) {
    return <button className="btn btn--sm factcheck-used" disabled>FACT CHECK USED</button>;
  }
  if (factCheckBlockReason(factCheckContextFromSnapshot(snapshot, myId))) return null;
  return (
    <button className="btn btn--sm factcheck-btn" onClick={onOpen} type="button">
      🚨 FACT CHECK
    </button>
  );
}

export function FactCheckPicker({
  open, speakerName, loading, claims, error, busy, onCancel, onSubmit,
}: {
  open: boolean;
  speakerName: string | null;
  loading: boolean;
  claims: ClaimOption[];
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (claimId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (!open) setSelected(null); }, [open]);
  return (
    <Modal open={open} onClose={onCancel} title="FACT CHECK" dismissible={!busy}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {speakerName ? `Choose a recent statement from ${speakerName}:` : 'Choose a recent statement:'}
        </p>
        {loading && <p>Finding recent claims...</p>}
        {!loading && error && <p>{error}</p>}
        {!loading && !error && claims.length === 0 && <p>No challengeable facts detected from this speaker yet.</p>}
        {!loading && !error && claims.length > 0 && (
          <ul className="factcheck-claims">
            {claims.map((c) => (
              <li key={c.id}>
                <label className="factcheck-claim">
                  <input
                    type="radio"
                    name="fact-claim"
                    checked={selected === c.id}
                    onChange={() => setSelected(c.id)}
                  />
                  <span>“{c.text}”</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="factcheck-actions">
          <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="btn btn--primary btn--sm"
            type="button"
            disabled={busy || loading || !selected}
            onClick={() => selected && onSubmit(selected)}
          >
            {busy ? 'Sending…' : 'CHALLENGE THIS CLAIM'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const MODEL_NAME: Record<JuryModel, string> = { gemini: 'Gemini', claude: 'Claude', chatgpt: 'ChatGPT' };
const MODEL_ROLE: Record<JuryModel, string> = { gemini: 'Evidence Analyst', claude: 'Skeptic', chatgpt: 'Referee Analyst' };
const MODEL_WORKING: Record<JuryModel, string> = {
  gemini: 'Analyzing evidence...',
  claude: 'Stress-testing claim...',
  chatgpt: 'Checking logic...',
};
const MODEL_ORDER: JuryModel[] = ['gemini', 'claude', 'chatgpt'];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function voteKind(verdict: JuryBinary): string {
  return verdict === 'INCORRECT' ? 'contradicted' : 'supported';
}

function voteTitle(verdict: JuryBinary): string {
  return verdict === 'INCORRECT' ? '🔴 INCORRECT' : '🟢 CORRECT';
}

function orderedVotes(votes: JuryVote[]): JuryVote[] {
  return [...votes].sort((a, b) => MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model));
}

function JuryWorking({ phase }: { phase: JuryPhase | null }) {
  if (phase === 'deliberating') return <p className="jury-phase">JURY DELIBERATING...</p>;
  return (
    <ul className="jury-working">
      {JURY_SEATS.map((model) => (
        <li key={model}><strong>{MODEL_NAME[model]}</strong> {MODEL_WORKING[model]}</li>
      ))}
    </ul>
  );
}

function JuryDetails({ jury }: { jury: JuryResult }) {
  return (
    <details className="jury-details">
      <summary>View Jury Details</summary>
      {orderedVotes(jury.votes).map((vote) => (
        <div key={vote.model} className="jury-details__card">
          <p><strong>{MODEL_NAME[vote.model]}</strong> · {vote.role}</p>
          <p>Initial: {vote.initialVerdict} {pct(vote.initialConfidence)}{vote.changedVote ? ' · changed vote' : ' · held vote'}</p>
          <p>Final: {vote.finalVerdict} {pct(vote.finalConfidence)}</p>
          <p>{vote.responseToOthers}</p>
          <p>{vote.reasoning}</p>
          {vote.limitations.length > 0 && (
            <ul>
              {vote.limitations.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
        </div>
      ))}
    </details>
  );
}

function JuryResultView({ jury }: { jury: JuryResult }) {
  const winning = Math.max(jury.votesForCorrect, jury.votesForIncorrect);
  const losing = Math.min(jury.votesForCorrect, jury.votesForIncorrect);
  const footer = jury.verdict === 'INCORRECT' ? 'CHALLENGE SUCCESSFUL' : jury.verdict === 'CORRECT' ? 'CHALLENGE FAILED' : 'NO DECISION';
  return (
    <>
      <ul className="jury-votes">
        {orderedVotes(jury.votes).map((vote) => (
          <li key={vote.model}>
            <div className="jury-votes__who">
              <strong>{MODEL_NAME[vote.model].toUpperCase()}</strong>
              <span>{MODEL_ROLE[vote.model]}</span>
            </div>
            <p className={`factcheck-banner__verdict factcheck-banner__verdict--${voteKind(vote.finalVerdict)}`}>{voteTitle(vote.finalVerdict)}</p>
            <p>Confidence: {pct(vote.finalConfidence)}</p>
            <p className="factcheck-banner__explain">“{vote.reasoning}”</p>
          </li>
        ))}
      </ul>
      <div className="jury-final">
        <div className="factcheck-banner__kicker">FINAL JURY VERDICT</div>
        <p className="jury-tally">{winning} — {losing}</p>
        {jury.verdict ? (
          <p className={`factcheck-banner__verdict factcheck-banner__verdict--${voteKind(jury.verdict)}`}>{voteTitle(jury.verdict)}</p>
        ) : (
          <p className="factcheck-banner__verdict factcheck-banner__verdict--inconclusive">SPLIT — NO DECISION</p>
        )}
        <ul className="jury-split">
          {orderedVotes(jury.votes).map((vote) => (
            <li key={vote.model}>
              {MODEL_NAME[vote.model]} {vote.finalVerdict === 'CORRECT' ? '✓ CORRECT' : '✗ INCORRECT'} {pct(vote.finalConfidence)}
            </li>
          ))}
        </ul>
        {jury.verdict && <p>Jury Confidence: {pct(jury.juryConfidence)}</p>}
        <div className="factcheck-banner__footer">{footer}</div>
      </div>
      <JuryDetails jury={jury} />
    </>
  );
}

function resolvedWithoutJury(f: FactCheckView): { title: string; footer: string; kind: string } {
  if (f.unavailable && f.explanation === 'JURY ERROR') return { title: 'JURY ERROR', footer: 'NO DECISION', kind: 'unavailable' };
  if (f.unavailable) return { title: 'FACT CHECK UNAVAILABLE', footer: 'NO DECISION', kind: 'unavailable' };
  if (f.verdict === 'INCORRECT' || f.verdict === 'CONTRADICTED') return { title: '🔴 INCORRECT', footer: 'CHALLENGE SUCCESSFUL', kind: 'contradicted' };
  if (f.verdict === 'CORRECT' || f.verdict === 'SUPPORTED') return { title: '🟢 CORRECT', footer: 'CHALLENGE FAILED', kind: 'supported' };
  return { title: '⚪ INCONCLUSIVE', footer: 'NO DECISION', kind: 'inconclusive' };
}

/** Visible to the whole room while a fact-check holds the floor. */
export function FactCheckBanner({ factCheck }: { factCheck: FactCheckView | null }) {
  if (!factCheck) return null;
  const fallback = factCheck.status === 'resolved' && !factCheck.jury ? resolvedWithoutJury(factCheck) : null;
  return (
    <div className="factcheck-banner" role="status" aria-live="polite">
      <div className="factcheck-banner__kicker">🚨 AI JURY</div>
      <p className="factcheck-banner__claim">
        <strong>{factCheck.challengerName}</strong> challenged {factCheck.speakerName}: “{factCheck.claim}”
      </p>
      {factCheck.status === 'checking' && <JuryWorking phase={factCheck.juryPhase} />}
      {factCheck.jury && <JuryResultView jury={factCheck.jury} />}
      {fallback && (
        <>
          <p className={`factcheck-banner__verdict factcheck-banner__verdict--${fallback.kind}`}>{fallback.title}</p>
          <div className="factcheck-banner__footer">{fallback.footer}</div>
        </>
      )}
    </div>
  );
}

function historyLine(f: FactCheckView): { mark: string; kind: string; text: string } {
  if (f.unavailable) return { mark: '○', kind: 'mid', text: `${f.challengerName} challenged ${f.speakerName} — Fact check unavailable` };
  if (f.outcome === 'successful') return { mark: '✓', kind: 'ok', text: `${f.challengerName} successfully challenged ${f.speakerName}` };
  if (f.outcome === 'failed') return { mark: '✗', kind: 'bad', text: `${f.challengerName} unsuccessfully challenged ${f.speakerName}` };
  return { mark: '○', kind: 'mid', text: `${f.challengerName} challenged ${f.speakerName} — Inconclusive` };
}

export function FactCheckHistory({ items }: { items: FactCheckView[] }) {
  const done = items.filter((f) => f.status === 'resolved');
  if (!done.length) return null;
  return (
    <section className="factcheck-history" aria-label="Fact checks">
      <h3>FACT CHECKS</h3>
      <ul>
        {done.map((f) => {
          const line = historyLine(f);
          return (
            <li key={f.id}>
              <span className={`mark mark--${line.kind}`} aria-hidden="true">{line.mark}</span>
              <div>
                <p>{line.text}</p>
                <p className="factcheck-quote">“{f.claim}”</p>
                {f.jury && <p className="factcheck-quote">{Math.max(f.jury.votesForCorrect, f.jury.votesForIncorrect)} — {Math.min(f.jury.votesForCorrect, f.jury.votesForIncorrect)} {f.jury.verdict ?? 'SPLIT'}</p>}
                {f.jury && <JuryDetails jury={f.jury} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
