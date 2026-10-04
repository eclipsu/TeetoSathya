import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS, normalizeUsername, validateUsername } from '@teeto/shared';
import { getSession, setUsername } from '../lib/session';
import './name-entry.css';

async function speakWelcome(name: string, ctx: AudioContext) {
  const res = await fetch('/api/welcome', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return;
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

export function NameEntry({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(getSession().username ?? '');
  const [touched, setTouched] = useState(false);
  const clean = normalizeUsername(name);
  const error = validateUsername(name);

  useEffect(() => {
    const el = dialog.current;
    if (!el || el.open) return;
    el.showModal();
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    const ctx = new AudioContext();
    void ctx.resume();
    setUsername(clean);
    onDone();
    void speakWelcome(clean, ctx).catch(() => {});
  }

  return (
    <dialog
      ref={dialog}
      className="name-modal"
      aria-labelledby="name-title"
      onCancel={(e) => {
        if (!onCancel) e.preventDefault();
        else onCancel();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && onCancel) onCancel();
      }}
    >
      <form className="name-modal__body" onSubmit={submit} noValidate>
        <h2 id="name-title">What should we call you?</h2>
        <p className="muted">This is the name the other team sees.</p>
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input input--lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={LIMITS.usernameMax + 10}
            placeholder="e.g. Sita"
            autoComplete="nickname"
            data-autofocus
            aria-invalid={touched && !!error}
            aria-describedby="name-hint"
          />
          <span id="name-hint" className={`field__hint ${touched && error ? 'field__hint--error' : ''}`}>
            {touched && error ? error : `${LIMITS.usernameMin}–${LIMITS.usernameMax} characters. Letters, numbers, spaces, _ or -.`}
          </span>
        </label>
        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={touched && !!error}>
          Continue
        </button>
      </form>
    </dialog>
  );
}
