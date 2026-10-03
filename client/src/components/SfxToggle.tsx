import { useSyncExternalStore } from 'react';
import { onSfxChange, primeAudio, setSfxEnabled, sfxEnabled } from '../lib/sfx';
import { BellIcon } from './icons';

export function SfxToggle() {
  const on = useSyncExternalStore((cb) => onSfxChange(cb), sfxEnabled);
  return (
    <button
      className={`icon-btn sfx-toggle ${on ? '' : 'is-off'}`}
      onClick={() => { primeAudio(); setSfxEnabled(!on); }}
      aria-pressed={on}
      aria-label={on ? 'Sound effects on' : 'Sound effects off'}
      title={on ? 'Sound effects: on' : 'Sound effects: off'}
    >
      <BellIcon />
    </button>
  );
}
