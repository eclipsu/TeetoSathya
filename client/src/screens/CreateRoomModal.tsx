import { useState, type FormEvent } from 'react';
import { LIMITS, validateRoomInput } from '@teeto/shared';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { api, ApiFailure } from '../lib/api';
import { getSession, saveHostToken } from '../lib/session';

// Light, non-political presets only.
const PRESETS: { label: string; topic: string; sides: [string, string] }[] = [
  { label: 'Cats vs Dogs', topic: 'Which make better pets?', sides: ['Cats', 'Dogs'] },
  { label: 'Remote vs Office', topic: 'Where do people do their best work?', sides: ['Remote work', 'Office'] },
  { label: 'College: worth it?', topic: 'Is college worth it?', sides: ['Worth it', 'Not worth it'] },
  { label: 'Pineapple on pizza', topic: 'Does pineapple belong on pizza?', sides: ['Yes', 'No'] },
  { label: 'Books vs Movies', topic: 'Which tells a story better?', sides: ['Books', 'Movies'] },
  { label: 'Morning vs Night', topic: 'Who gets more done?', sides: ['Morning people', 'Night owls'] },
  { label: 'Mountains vs Beach', topic: 'Better vacation?', sides: ['Mountains', 'Beach'] },
];

const TURN_OPTIONS = [30, 60, 90, 120, 180, 300];
const ROUND_OPTIONS = [300, 600, 900, 1200, 1800];

function fmt(seconds: number) {
  return seconds < 60 ? `${seconds}s` : seconds % 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds / 60} min`;
}

export function CreateRoomModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (roomId: string) => void }) {
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [turnSeconds, setTurn] = useState<number>(LIMITS.turnSecondsDefault);
  const [roundSeconds, setRound] = useState<number>(LIMITS.roundSecondsDefault);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validateRoomInput({ topic, sides: [sideA, sideB], turnSeconds, roundSeconds });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors([]);
    setBusy(true);
    try {
      const s = getSession();
      const res = await api.createRoom({ ...parsed.value, hostSessionId: s.sessionId, hostName: s.username ?? '' });
      saveHostToken(res.roomId, res.hostToken);
      toast('success', 'Room created. You are the host.');
      onCreated(res.roomId);
    } catch (err) {
      setErrors(err instanceof ApiFailure && err.details ? err.details : [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a debate room" sheet>
      <form onSubmit={submit} className="stack" noValidate>
        <div className="chips" role="group" aria-label="Topic presets">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.topic}
              className="chip"
              onClick={() => {
                setTopic(p.topic);
                setSideA(p.sides[0]);
                setSideB(p.sides[1]);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field__label">
            Topic <span className="field__count">{topic.trim().length}/{LIMITS.topicMax}</span>
          </span>
          <input className="input" value={topic} maxLength={LIMITS.topicMax} onChange={(e) => setTopic(e.target.value)} placeholder="What's the question?" data-autofocus />
        </label>

        <div className="grid-2">
          <label className="field">
            <span className="field__label"><span className="dot dot--a" /> Side A</span>
            <input className="input input--a" value={sideA} maxLength={LIMITS.sideMax} onChange={(e) => setSideA(e.target.value)} placeholder="e.g. Cats" />
          </label>
          <label className="field">
            <span className="field__label"><span className="dot dot--b" /> Side B</span>
            <input className="input input--b" value={sideB} maxLength={LIMITS.sideMax} onChange={(e) => setSideB(e.target.value)} placeholder="e.g. Dogs" />
          </label>
        </div>

        <div className="grid-2">
          <label className="field">
            <span className="field__label">Talk time per speaker</span>
            <select className="input" value={turnSeconds} onChange={(e) => setTurn(Number(e.target.value))}>
              {TURN_OPTIONS.map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Round length</span>
            <select className="input" value={roundSeconds} onChange={(e) => setRound(Number(e.target.value))}>
              {ROUND_OPTIONS.map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
            </select>
          </label>
        </div>

        {errors.length > 0 && (
          <ul className="form-errors" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Creating…' : 'Create room'}</button>
        </div>
      </form>
    </Modal>
  );
}
