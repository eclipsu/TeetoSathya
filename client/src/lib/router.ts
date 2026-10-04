import { useSyncExternalStore } from 'react';

// Tiny history router: two routes don't justify a dependency.
const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(path: string, replace = false): void {
  if (path === location.pathname) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  listeners.forEach((l) => l());
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

/** /board/<room>: the live board, fed only by SpacetimeDB. */
export function matchBoard(path: string): string | null {
  const m = /^\/board\/([a-z0-9]{4,16})\/?$/i.exec(path);
  return m ? m[1]! : null;
}

export function matchRoom(path: string): string | null {
  const m = /^\/room\/([a-z0-9]{4,16})\/?$/i.exec(path);
  return m ? m[1]! : null;
}
