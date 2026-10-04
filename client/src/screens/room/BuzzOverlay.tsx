import type { BuzzView } from '@teeto/shared';

interface Props {
  /** Current locked buzz from room state (persists until the host dismisses). */
  locked: BuzzView | null;
  challengedName: string | null;
}

/** Screen-reader announcement for a buzz. The visible card lives in the middle of the stage. */
export function BuzzOverlay({ locked, challengedName }: Props) {
  return (
    <div className="sr-only" role="alert" aria-live="assertive">
      {locked ? `${locked.username} buzzed in${challengedName ? ` on ${challengedName}` : ''}. Waiting for the host.` : ''}
    </div>
  );
}
