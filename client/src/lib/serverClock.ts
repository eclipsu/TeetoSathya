import type { Socket } from 'socket.io-client';

/**
 * Server-authoritative time. We estimate offset = serverNow - clientNow with an NTP-lite ping:
 * take several samples and trust the one with the lowest round trip (least queuing noise).
 */
let offsetMs = 0;
let bestRtt = Infinity;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function clockOffset(): { offsetMs: number; rttMs: number } {
  return { offsetMs, rttMs: bestRtt };
}

function sample(socket: Socket): Promise<{ offset: number; rtt: number } | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const timer = setTimeout(() => resolve(null), 2000);
    socket.emit('time:ping', (server: number) => {
      clearTimeout(timer);
      const t1 = Date.now();
      const rtt = t1 - t0;
      resolve({ offset: server + rtt / 2 - t1, rtt });
    });
  });
}

/** Run a burst of samples now and again periodically. Returns a stop function. */
export function startClockSync(socket: Socket, every = 30_000): () => void {
  let stopped = false;
  const burst = async () => {
    bestRtt = Infinity; // re-measure: network conditions change
    for (let i = 0; i < 5 && !stopped; i++) {
      const s = await sample(socket);
      if (s && s.rtt <= bestRtt) {
        bestRtt = s.rtt;
        offsetMs = s.offset;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  void burst();
  const t = setInterval(burst, every);
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
