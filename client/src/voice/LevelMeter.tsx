/** Segmented level meter (0-1). Purely visual. */
export function LevelMeter({ level, segments = 8, className = '' }: { level: number; segments?: number; className?: string }) {
  const lit = Math.round(level * segments);
  return (
    <span className={`level-meter ${className}`} role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={`level-meter__seg ${i < lit ? 'is-lit' : ''} ${i >= segments * 0.8 ? 'is-hot' : ''}`} />
      ))}
    </span>
  );
}
