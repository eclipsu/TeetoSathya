import { formatClock } from '../state/clock';
import './timer.css';

interface TimerProps {
  ms: number;
  running: boolean;
  label: string;
  size?: 'lg' | 'md' | 'sm';
  /** Warn thresholds only matter for clocks that can run out on someone. */
  warn?: boolean;
}

/** Big tabular-digit clock. Amber under 30s, pulsing red under 10s (only while running). */
export function Timer({ ms, running, label, size = 'md', warn = true }: TimerProps) {
  const level = !warn ? '' : ms <= 10_000 ? 'timer--danger' : ms <= 30_000 ? 'timer--warn' : '';
  return (
    <div className={`timer timer--${size} ${level} ${running ? 'is-running' : 'is-stopped'}`}>
      <span className="timer__label">{label}</span>
      <span className="timer__digits" role="timer" aria-label={`${label}: ${formatClock(ms)}`}>
        {formatClock(ms)}
      </span>
    </div>
  );
}
