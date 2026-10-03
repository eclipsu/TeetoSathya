import { useState, type FormEvent } from 'react';
import { APP_NAME, LIMITS, normalizeUsername, validateUsername } from '@teeto/shared';
import { Avatar } from '../components/Avatar';
import { ArrowRightIcon } from '../components/icons';
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
    <main className="hero">
      <div className="hero__aura" aria-hidden="true" />
      <form className="hero__card glass" onSubmit={submit} noValidate>
        <h1 className="hero__logo">
          <span className="hero__logo-a">Teeto</span>
          <span className="hero__logo-b">Sathya</span>
        </h1>
        <p className="hero__tag">Live team debates. Take the hot seat. Buzz in to challenge.</p>

        <div className="hero__preview" aria-hidden="true">
          <Avatar name={clean || '?'} size={112} />
        </div>

        <label className="field">
          <span className="field__label">Pick a username</span>
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
          Enter {APP_NAME} <ArrowRightIcon />
        </button>
      </form>
    </main>
  );
}
