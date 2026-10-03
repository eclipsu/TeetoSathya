export type ChipState = 'ok' | 'warn' | 'bad' | 'idle';

export function ConnectionChip({ state, label }: { state: ChipState; label: string }) {
  return (
    <span className={`conn-chip conn-chip--${state}`} role="status" aria-live="polite">
      <span className="conn-chip__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
