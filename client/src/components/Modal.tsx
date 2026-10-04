import { useEffect, useRef, type ReactNode } from 'react';
import './modal.css';

let openCount = 0;
/** Used by the Space buzzer: never fire while a dialog is open. */
export function isModalOpen(): boolean {
  return openCount > 0;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Bottom-sheet style on small screens. */
  sheet?: boolean;
  /** Prevent closing via Esc / backdrop (e.g. a required choice). */
  dismissible?: boolean;
}

// Native <dialog> gives focus trapping, Esc handling and inert background for free.
export function Modal({ open, onClose, title, children, sheet = false, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      openCount++;
      // React's autoFocus doesn't survive showModal(); honor an explicit marker, else focus the
      // title (never a choice button: Space/Enter would silently activate it).
      (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('#modal-title'))?.focus();
      return () => {
        openCount--;
        if (d.open) d.close();
      };
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${sheet ? 'modal--sheet' : ''}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal__body">
          <header className="modal__head">
            <h2 id="modal-title" tabIndex={-1}>{title}</h2>
            {dismissible && (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="muted">{message}</p>
      <div className="modal__actions">
        {/* Safe default: Enter on a destructive confirm should not destroy anything. */}
        <button className="btn btn--ghost" onClick={onCancel} data-autofocus>Cancel</button>
        <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
