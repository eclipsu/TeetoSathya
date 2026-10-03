import { useEffect, useState } from 'react';
import { APP_NAME, type HealthResponse } from '@teeto/shared';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="placeholder">
      <h1 className="logo">{APP_NAME}</h1>
      <p>{health ? `Server OK · ${new Date(health.serverNow).toLocaleTimeString()}` : error ?? 'Connecting…'}</p>
    </main>
  );
}
