import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import './toasts.css';

export type ToastType = 'info' | 'success' | 'warn' | 'error';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

const Ctx = createContext<(type: ToastType, message: string) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const push = useCallback((type: ToastType, message: string) => {
    const id = next.current++;
    // Collapse identical toasts fired in quick succession.
    setToasts((t) => (t.some((x) => x.message === message) ? t : [...t.slice(-3), { id, type, message }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);

  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
