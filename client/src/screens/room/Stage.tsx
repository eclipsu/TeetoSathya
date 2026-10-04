import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BuzzView, FactCheckView, RoomSnapshot, TeamIndex } from '@teeto/shared';
import { Avatar } from '../../components/Avatar';
import { PlayIcon } from '../../components/icons';
import { Timer } from '../../components/Timer';
import { playChallenge, playWhoosh } from '../../lib/sfx';
import { roundRemaining, useServerNow } from '../../state/clock';
import { ChallengeCard, type TiebreakControls } from './FactCheck';
import { HotSeatCard } from './HotSeatCard';

interface Props {
  snapshot: RoomSnapshot;
  myId: string | null;
  isHost: boolean;
  onDone: () => void;
  onStart: () => void;
  /** Host pressed Start; the announcement is being prepared. */
  starting?: boolean;
  interimText: string | null;
  transcriptionAvailable: boolean | null;
  /** The challenger's own claim picker. Only this viewer sees it in the middle. */
  picker?: ReactNode;
  /** Jury message being read aloud right now. */
  speakingId?: string | null;
  tiebreak?: TiebreakControls;
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
export function Stage({ snapshot: s, myId, isHost, onDone, onStart, starting = false, interimText, transcriptionAvailable, picker, speakingId = null, tiebreak }: Props) {
  const live = s.status === 'live';
  const now = useServerNow(live);
  const g = s.game;
  const roundMs = roundRemaining(s, now);
  const runningRound = live && g.roundEndsAt !== null;
  const resumeMs = g.factCheckResumeAt === null ? null : g.factCheckResumeAt - now;
  const resumeSeconds = resumeMs !== null && resumeMs > 0 ? Math.ceil(resumeMs / 1000) : null;
  const introMs = g.intro ? g.intro.until - now : null;
  const introSeconds = introMs !== null && introMs > 0 ? Math.ceil(introMs / 1000) : null;

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
    // A fact check gets the objection sting; a buzz card keeps the whoosh (the buzz has its own sound).
    if (seenKey.current !== undefined && key && key !== seenKey.current) (key.startsWith('f:') ? playChallenge : playWhoosh)();
    seenKey.current = key;
  }, [center?.kind === 'pick' ? null : center?.key]);

  const total = s.settings.totalRounds;
  const roundName = `Round ${g.round || 1}${total > 1 ? ` of ${total}` : ''}`;
  const roundLabel = !live
    ? `${total} round${total === 1 ? '' : 's'}`
    : g.intermission ? 'Round over' : g.intro ? 'Opening' : g.factCheck ? 'Fact check' : g.buzz ? 'Buzz' : g.paused ? 'Paused' : 'Live';
  const im = g.intermission;
  const breakMs = im ? im.until - now : null;
  const breakSeconds = breakMs !== null && breakMs > 0 ? Math.ceil(breakMs / 1000) : null;
  const nextOpener = im?.openerId ? s.participants.find((p) => p.id === im.openerId)?.username ?? null : null;
  const opener = g.openerId ? s.participants.find((p) => p.id === g.openerId)?.username ?? null : null;
  const seated = ([0, 1] as const).every((t) => s.participants.some((p) => p.role === 'speaker' && p.team === t));
  const challenging = !!center;

  return (
    <section className={`stage ${live ? 'stage--live' : ''} ${challenging ? 'stage--challenge' : ''}`} aria-label="Stage">
      <div className="stage__round">
        {live && (
          <p className="stage__roundname" aria-label={roundName}>
            <span className="stage__roundname-label">Round</span>
            <span className="stage__roundname-num">{g.round || 1}</span>
            {total > 1 && <span className="stage__roundname-of">/ {total}</span>}
          </p>
        )}
        <Timer ms={roundMs} running={runningRound} label={roundLabel} size="lg" warn={live} />
        {live && (!challenging || center?.kind === 'pick') && <LiveTranscript text={interimText} />}
        {live && (g.scores[0] > 0 || g.scores[1] > 0) && (
          <p className="stage__score" aria-label={`${s.sides[0]} ${g.scores[0]}, ${s.sides[1]} ${g.scores[1]}`}>
            <span className="dot dot--a" />{s.sides[0]} <strong>{g.scores[0]}</strong>
            <span className="stage__score-dash">–</span>
            <strong>{g.scores[1]}</strong> {s.sides[1]}<span className="dot dot--b" />
          </p>
        )}
        {im && (
          <div className="stage__break" aria-live="polite">
            <p className="stage__break-title">
              Round {g.round} over{im.endedBy === 'out' && im.outTeam !== null ? `: ${s.sides[im.outTeam]} ran out of speakers` : im.endedBy === 'time' ? ': time is up' : ''}
            </p>
            <p className="stage__break-next">
              Round {im.nextRound}: {nextOpener ? <strong>{nextOpener}</strong> : 'a new speaker'} opens for {s.sides[im.openingSide]}
              {breakSeconds !== null && <> · in {breakSeconds}s</>}
            </p>
          </div>
        )}
        {live && !im && (
          <p className={`stage__claim ${g.roundClaim ? '' : 'is-waiting'}`}>
            <span className="stage__claim-label">Round claim</span>
            {g.roundClaim ? <span className="stage__claim-text">“{g.roundClaim.text}”</span> : <span>Waiting for {opener ?? 'the opener'}'s opening claim…</span>}
          </p>
        )}
        {g.intro && introSeconds !== null && (
          <div className={`stage__intro ${speakingId === 'intro' ? 'is-speaking' : ''}`} aria-live="polite">
            <p className="stage__intro-text">{g.intro.text}</p>
            <p className="stage__countdown" role="timer" aria-label={`Floor opens in ${introSeconds} seconds`}>
              <span className="stage__countdown-num">{introSeconds}</span>
              <span className="stage__countdown-label">Floor opens</span>
            </p>
          </div>
        )}
        {resumeSeconds !== null && (
          <p className="stage__countdown" role="timer" aria-live="polite" aria-label={`Resuming in ${resumeSeconds} seconds`}>
            <span className="stage__countdown-num">{resumeSeconds}</span>
            <span className="stage__countdown-label">Get ready</span>
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
                ? <ChallengeCard check={shown.check} speakingId={speakingId} tiebreak={tiebreak} />
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
            <button className="btn btn--primary stage__start" onClick={onStart} disabled={!seated || starting}>
              <PlayIcon /> {starting ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Keep the last words up briefly after the server clears them, so the gap between sentences doesn't blink. */
const TRANSCRIPT_HOLD_MS = 1200;

/**
 * The speaker's words as they talk. Always takes the same two lines of space and fades instead of
 * mounting/unmounting, so nothing on the stage jumps while transcription comes and goes.
 */
function LiveTranscript({ text }: { text: string | null }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text) return setShown(text);
    const t = setTimeout(() => setShown(null), TRANSCRIPT_HOLD_MS);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <p className={`transcript-live ${shown ? 'is-on' : ''}`} aria-live="off">
      <span className="transcript-live__text">{shown ? `“${shown}”` : '\u00a0'}</span>
    </p>
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
