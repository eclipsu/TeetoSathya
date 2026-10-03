import { useEffect, useState } from 'react';
import type { BuzzView } from '@teeto/shared';
import { Avatar, avatarLook } from '../../components/Avatar';
import { BellIcon } from '../../components/icons';
import './buzz.css';

interface Props {
  /** Fresh buzz:locked event; `n` changes per buzz so the animation replays. */
  event: { buzz: BuzzView; n: number } | null;
  /** Current locked buzz from room state (persists until the host dismisses). */
  locked: BuzzView | null;
  challengedName: string | null;
}

const BIG_MS = 1900;

/**
 * Dramatic moment (~550ms entrance, one radial flash, no strobing), then it settles into
 * a banner that stays until the host dismisses the buzz.
 */
export function BuzzOverlay({ event, locked, challengedName }: Props) {
  const [bigFor, setBigFor] = useState<number | null>(null);

  useEffect(() => {
    if (!event) return;
    setBigFor(event.n);
    const t = setTimeout(() => setBigFor((n) => (n === event.n ? null : n)), BIG_MS);
    return () => clearTimeout(t);
  }, [event]);

  const buzz = locked ?? (bigFor !== null ? event?.buzz ?? null : null);
  const showBig = bigFor !== null && !!event && (!locked || locked.participantId === event.buzz.participantId);

  return (
    <>
      {/* Screen-reader announcement, independent of visuals */}
      <div className="sr-only" role="alert" aria-live="assertive">
        {locked ? `${locked.username} buzzed in${challengedName ? ` on ${challengedName}` : ''}. Waiting for the host.` : ''}
      </div>
      {buzz && showBig && (
        <div className="buzz-fx" style={{ ['--buzz-color' as string]: avatarLook(buzz.username).accent }} aria-hidden="true" key={bigFor}>
          <div className="buzz-fx__flash" />
          <div className="buzz-fx__edge" />
          <div className="buzz-fx__card">
            <div className="buzz-fx__avatar"><Avatar name={buzz.username} size={140} /></div>
            <div className="buzz-fx__text">BUZZ!</div>
            <div className="buzz-fx__who"><strong>{buzz.username}</strong> buzzed in{challengedName ? ` on ${challengedName}` : ''}!</div>
          </div>
        </div>
      )}
      {locked && !showBig && (
        <div className="buzz-banner" style={{ ['--buzz-color' as string]: avatarLook(locked.username).accent }}>
          <BellIcon width={18} height={18} />
          <Avatar name={locked.username} size={28} />
          <span><strong>{locked.username}</strong> BUZZED IN{challengedName ? ` on ${challengedName}` : ''}. Clocks paused, waiting for the host.</span>
        </div>
      )}
    </>
  );
}
