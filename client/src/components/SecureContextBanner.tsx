import { useState } from 'react';
import { WarnIcon } from './icons';

/** Explains why the mic can't work instead of failing silently (plain http on a LAN IP). */
export function SecureContextBanner() {
  const [hidden, setHidden] = useState(false);
  const insecure = !window.isSecureContext || !navigator.mediaDevices;
  if (!insecure || hidden) return null;
  const origin = location.origin;
  return (
    <div className="banner" role="alert">
      <WarnIcon />
      <div>
        <strong>Microphone unavailable on this address.</strong> Browsers only allow the mic on <code>https://</code> or{' '}
        <code>localhost</code>. You can still listen and buzz. To speak from this device in Chrome: open{' '}
        <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>, add <code>{origin}</code>, set it to Enabled
        and relaunch. Full steps: <code>docs/LAN.md</code>.
      </div>
      <button className="btn btn--ghost btn--sm" onClick={() => setHidden(true)}>Dismiss</button>
    </div>
  );
}
