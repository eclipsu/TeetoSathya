import { useEffect, useRef, useState } from "react";
import {
  factCheckBlockReason,
  factCheckContextFromSnapshot,
  JURY_SEATS,
  type ClaimOption,
  type FactCheckView,
  type JuryModel,
  type RoomSnapshot,
} from "@teeto/shared";
import { Modal } from "../../components/Modal";
import "./factcheck.css";

export function FactCheckButton({
  snapshot,
  myId,
  onOpen,
}: {
  snapshot: RoomSnapshot;
  myId: string | null;
  onOpen: () => void;
}) {
  const me = myId
    ? snapshot.participants.find((p) => p.id === myId)
    : undefined;
  if (!me || me.role !== "speaker" || snapshot.status === "ended") return null;
  if (snapshot.game.factCheckUsedIds.includes(me.id)) {
    return (
      <button className="btn btn--sm factcheck-used" disabled>
        FACT CHECK USED
      </button>
    );
  }
  if (factCheckBlockReason(factCheckContextFromSnapshot(snapshot, myId)))
    return null;
  return (
    <button
      className="btn btn--sm factcheck-btn"
      onClick={onOpen}
      type="button"
    >
      🚨 FACT CHECK
    </button>
  );
}

export function FactCheckPicker({
  open,
  speakerName,
  loading,
  claims,
  error,
  busy,
  onCancel,
  onSubmit,
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
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="FACT CHECK"
      dismissible={!busy}
    >
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {speakerName
            ? `Choose a recent statement from ${speakerName}:`
            : "Choose a recent statement:"}
        </p>
        {loading && <p>Finding recent claims...</p>}
        {!loading && error && <p>{error}</p>}
        {!loading && !error && claims.length === 0 && (
          <p>No challengeable facts detected from this speaker yet.</p>
        )}
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
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="btn btn--primary btn--sm"
            type="button"
            disabled={busy || loading || !selected}
            onClick={() => selected && onSubmit(selected)}
          >
            {busy ? "Sending…" : "CHALLENGE THIS CLAIM"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const MODEL_NAME: Record<JuryModel, string> = {
  gemini: "Gemini",
  gemini_skeptic: "Gemini 2",
  groq: "Groq",
  claude: "Claude",
  chatgpt: "ChatGPT",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function finalLine(f: FactCheckView): { text: string; kind: string } {
  if (f.status === "checking")
    return {
      text: f.juryPhase === "deliberating" ? "Deliberating…" : "Checking…",
      kind: "wait",
    };
  if (f.unavailable) return { text: "Final: No decision", kind: "mid" };
  const confidence = f.jury?.verdict ? ` · ${pct(f.jury.juryConfidence)}` : "";
  if (f.jury?.offTopic)
    return { text: `Different and incorrect${confidence}`, kind: "bad" };
  if (f.verdict === "INCORRECT" || f.verdict === "CONTRADICTED")
    return { text: `Final: Incorrect${confidence}`, kind: "bad" };
  if (f.verdict === "CORRECT" || f.verdict === "SUPPORTED")
    return { text: `Final: Correct${confidence}`, kind: "ok" };
  if (f.jury && !f.jury.verdict) return { text: "Final: Split", kind: "mid" };
  return { text: "Final: No decision", kind: "mid" };
}

function FactMessage({ item }: { item: FactCheckView }) {
  const final = finalLine(item);
  const votes = item.jury?.votes ?? [];
  return (
    <article className="fact-msg">
      <p className="fact-msg__who">
        {item.challengerName} challenged {item.speakerName}
      </p>
      <p className="fact-msg__claim">“{item.claim}”</p>
      <ul className="fact-msg__scores">
        {(votes.length
          ? votes
          : JURY_SEATS.map((model) => ({
              model,
              finalConfidence: null as number | null,
            }))
        ).map((vote) => (
          <li key={vote.model}>
            <span>{MODEL_NAME[vote.model]}</span>
            <span>
              {vote.finalConfidence == null ? "…" : pct(vote.finalConfidence)}
            </span>
          </li>
        ))}
      </ul>
      <p className={`fact-msg__final fact-msg__final--${final.kind}`}>
        {final.text}
      </p>
      {item.scoreDelta != null && item.scoreDelta !== 0 && (
        <p className={`fact-msg__points fact-msg__points--${item.scoreDelta > 0 ? "up" : "down"}`}>
          {item.scoreDelta > 0 ? `+${item.scoreDelta}` : item.scoreDelta} points
        </p>
      )}
    </article>
  );
}

/** Left-bar chat of fact checks. Confidences and the final answer only. */
export function FactChat({
  items,
  armed,
}: {
  items: FactCheckView[];
  armed?: { challengerName: string; speakerName: string } | null;
}) {
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, armed]);
  return (
    <aside className="fact-chat" aria-label="Fact check chat">
      <header className="fact-chat__head">Fact checks</header>
      <div className="fact-chat__log" ref={log}>
        {items.length === 0 && !armed && (
          <p className="fact-chat__empty">Claims show up here.</p>
        )}
        {items.map((item) => (
          <FactMessage key={item.id} item={item} />
        ))}
        {armed && !items.some((item) => item.status === "checking") && (
          <article className="fact-msg fact-msg--hold">
            <p className="fact-msg__who">
              {armed.challengerName} called a fact check
            </p>
            <p className="fact-msg__final fact-msg__final--wait">
              {armed.speakerName}, your microphone is off.
            </p>
          </article>
        )}
      </div>
    </aside>
  );
}
