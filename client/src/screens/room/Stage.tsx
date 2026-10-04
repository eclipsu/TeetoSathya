import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BuzzView, FactCheckView, RoomSnapshot, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { PlayIcon } from '../../components/icons';
import { Timer } from '../../components/Timer';
import { playWhoosh } from '../../lib/sfx';
import { roundRemaining, useServerNow } from '../../state/clock';
import { ChallengeCard } from './FactCheck';
import { HotSeatCard } from './HotSeatCard';

interface Props {
  snapshot: RoomSnapshot;
  myId: string | null;
  isHost: boolean;
  onDone: () => void;
  onStart: () => void;
  interimText: string | null;
  transcriptionAvailable: boolean | null;
  /** The challenger's own claim picker. Only this viewer sees it in the middle. */
  picker?: ReactNode;
}

type Center =
  | { kind: 'fact'; key: string; check: FactCheckView }
  | { kind: 'buzz'; key: string; buzz: BuzzView; challenged: string | null; team: TeamIndex | null }
  | { kind: 'pick'; key: string; node: ReactNode };

const EXIT_MS = 450;

/** Keeps the last center card mounted while the stage slides back, so it doesn't vanish mid-motion. */
function useLinger(center: Center | null): { shown: Center | null; leaving: boolean } {
  const key = center?.key ?? null;
  const last = useRef<Center | null>(null);
  const prevKey = useRef<string | null>(key);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = key;
    if (key || !prev) return setLeavingKey(null);
    setLeavingKey(prev);
    const t = setTimeout(() => setLeavingKey(null), EXIT_MS);
    return () => clearTimeout(t);
  }, [key]);
  if (center) last.current = center;
  // prevKey covers the first render after the challenge clears, before the effect runs.
  const lingering = !center && !!last.current && (leavingKey === last.current.key || prevKey.current === last.current.key);
  const shown = center ?? (lingering ? last.current : null);
  return { shown, leaving: lingering };
}

/** Center stage: round timer, two hot seats, and the challenge card that slides up between them. */
export function Stage({ snapshot: s, myId, isHost, onDone, onStart, interimText, transcriptionAvailable, picker }: Props) {
  const live = s.status === 'live';
  const now = useServerNow(live);
  const g = s.game;
  const roundMs = roundRemaining(s, now);
  const runningRound = live && g.roundEndsAt !== null;
  const resumeMs = g.factCheckResumeAt === null ? null : g.factCheckResumeAt - now;
  const resumeSeconds = resumeMs !== null && resumeMs > 0 ? Math.ceil(resumeMs / 1000) : null;

  const buzzer = g.buzz ? s.participants.find((p) => p.id === g.buzz!.participantId) : undefined;
  const center: Center | null = g.factCheck
    ? { kind: 'fact', key: `f:${g.factCheck.id}`, check: g.factCheck }
    : g.buzz
      ? {
        kind: 'buzz',
        key: `b:${g.buzz.at}`,
        buzz: g.buzz,
        challenged: s.participants.find((p) => p.id === g.buzz!.challengedParticipantId)?.username ?? null,
        team: buzzer?.role === 'speaker' ? buzzer.team : null,
      }
      : picker
        ? { kind: 'pick', key: 'pick', node: picker }
        : null;
  const { shown, leaving } = useLinger(center);

  // Whoosh once per new challenge, not on reconnect or for one already open on join.
  // The picker is local and silent, so it doesn't count.
  const seenKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const key = center?.kind === 'pick' ? null : center?.key ?? null;
    if (seenKey.current !== undefined && key && key !== seenKey.current) playWhoosh();
    seenKey.current = key;
  }, [center?.kind === 'pick' ? null : center?.key]);

  const roundLabel = !live
    ? 'Round ready'
    : `Round ${g.round || 1} · ${g.factCheck ? 'Fact check' : g.buzz ? 'Buzz' : g.paused ? 'Paused' : 'Live'}`;
  const seated = ([0, 1] as const).every((t) => s.participants.some((p) => p.role === 'speaker' && p.team === t));
  const challenging = !!center;

  return (
    <section className={`stage ${live ? 'stage--live' : ''} ${challenging ? 'stage--challenge' : ''}`} aria-label="Stage">
      <div className="stage__round">
        <Timer ms={roundMs} running={runningRound} label={roundLabel} size="lg" warn={live} />
        {live && interimText && (!challenging || center?.kind === 'pick') && <p className="transcript-live">“{interimText}”</p>}
        {live && (g.scores[0] > 0 || g.scores[1] > 0) && (
          <p className="stage__score" aria-label={`${s.sides[0]} ${g.scores[0]}, ${s.sides[1]} ${g.scores[1]}`}>
            <span className="dot dot--a" />{s.sides[0]} <strong>{g.scores[0]}</strong>
            <span className="stage__score-dash">–</span>
            <strong>{g.scores[1]}</strong> {s.sides[1]}<span className="dot dot--b" />
          </p>
        )}
        {resumeSeconds !== null && (
          <p className="stage__countdown" role="timer" aria-live="polite" aria-label={`Resuming in ${resumeSeconds} seconds`}>
            <span className="stage__countdown-num">{resumeSeconds}</span>
            <span className="stage__countdown-label">Resuming</span>
          </p>
        )}
        {live && transcriptionAvailable === false && <p className="transcript-off">Transcription unavailable</p>}
      </div>

      <div className={`stage__seats ${challenging ? 'is-challenge' : ''} ${leaving ? 'is-leaving' : ''}`}>
        <HotSeatCard side={0} snapshot={s} now={now} myId={myId} onDone={onDone} compact={challenging} />
        <div className="stage__center" aria-hidden={!shown}>
          {shown && (
            <div className="stage__center-inner" key={shown.key}>
              {shown.kind === 'fact'
                ? <ChallengeCard check={shown.check} />
                : shown.kind === 'pick'
                  ? shown.node
                  : <BuzzCard buzz={shown.buzz} challenged={shown.challenged} team={shown.team} />}
            </div>
          )}
        </div>
        <HotSeatCard side={1} snapshot={s} now={now} myId={myId} onDone={onDone} compact={challenging} />
      </div>

      {!live && (
        <div className="stage__lobby">
          <p className="stage__hint">
            {!seated
              ? 'Each side needs at least one speaker.'
              : isHost
                ? 'Speakers are seated. Start when everyone is ready.'
                : 'Waiting for the host to start.'}
          </p>
          {isHost && (
            <button className="btn btn--primary stage__start" onClick={onStart} disabled={!seated}>
              <PlayIcon /> Start
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BuzzCard({ buzz, challenged, team }: { buzz: BuzzView; challenged: string | null; team: TeamIndex | null }) {
  const marker = team === 0 ? 'a' : team === 1 ? 'b' : 'none';
  return (
    <article className={`buzz-card tile buzz-card--${marker}`} aria-label="Buzz">
      <span className="buzz-card__dot" aria-hidden="true" />
      <Avatar name={buzz.username} size={56} />
      <div className="buzz-card__text">BUZZ</div>
      <div className="buzz-card__who">
        {challenged ? `${buzz.username} challenged ${challenged}` : `${buzz.username} buzzed in`}
      </div>
      <div className="buzz-card__wait">Clocks paused. Waiting for the host.</div>
    </article>
  );
}
