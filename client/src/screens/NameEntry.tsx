import { useState, type FormEvent } from 'react';
import { APP_NAME, LIMITS, normalizeUsername, validateUsername } from '@teeto/shared';
import { Avatar } from '../components/Avatar';
import { getSession, setUsername } from '../lib/session';
import './name-entry.css';

export function NameEntry({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(getSession().username ?? '');
  const [touched, setTouched] = useState(false);
  const clean = normalizeUsername(name);
  const error = validateUsername(name);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    setUsername(clean);
    onDone();
  }

  return (
    <main className="entry">
      <div className="entry__panel">
        <p className="entry__brand">{APP_NAME}</p>
        <div className="entry__intro">
          <h1>Enter the debate</h1>
          <p>Choose the name other speakers will see and hear.</p>
        </div>

        <Avatar name={clean || '?'} size={112} />

        <form className="entry__form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field__label">Display name</span>
            <input
              className="input input--lg"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={LIMITS.usernameMax + 10}
              placeholder="e.g. Sita_42"
              autoComplete="nickname"
              autoFocus
              aria-invalid={touched && !!error}
              aria-describedby="name-hint"
            />
            <span id="name-hint" className={`field__hint ${touched && error ? 'field__hint--error' : ''}`}>
              {touched && error ? error : `${LIMITS.usernameMin}-${LIMITS.usernameMax} characters: letters, numbers, space, _ or -`}
            </span>
          </label>

          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={touched && !!error}>
            Enter {APP_NAME}
          </button>
        </form>

        <p className="entry__foot">Voice only · no camera</p>
      </div>
    </main>
  );
}
