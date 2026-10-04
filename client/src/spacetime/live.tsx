import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { navigate } from '../lib/router';
import { hostedSpacetimeDatabase } from './hosted';

/** Phase names as the live index stores them. */
export const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'Open',
  LIVE: 'Live',
  FACT_CHECK: 'Fact check',
  TIEBREAK: 'Jury split',
  BREAK: 'Between rounds',
  ENDED: 'Ended',
};

export const sideIndex = (side: string): 0 | 1 | null => (side === 'TEAM_A' ? 0 : side === 'TEAM_B' ? 1 : null);

/**
 * A lobby card's live strip, read straight from SpacetimeDB's live index (one row by room id),
 * so a lobby with many debates stays current without polling the game server.
 */
export function LiveCardInfo({ roomId }: { roomId: string }) {
  if (!hostedSpacetimeDatabase) return null;
  return <LiveCardRow roomId={roomId} />;
}

function LiveCardRow({ roomId }: { roomId: string }) {
  const [rows] = useTable(tables.liveDebate.where((r) => r.roomId.eq(roomId)));
  const d = rows[0];
  if (!d || d.phase === 'LOBBY') return null;
  const speakerSide = sideIndex(d.speakerSide);
  return (
    <div className="live-strip" aria-label="Live from SpacetimeDB">
      <div className="live-strip__top">
        <span className={`live-strip__phase live-strip__phase--${d.phase.toLowerCase()}`}>{PHASE_LABEL[d.phase] ?? d.phase}</span>
        {d.round > 0 && <span className="live-strip__round">Round {d.round}{d.totalRounds > 1 ? `/${d.totalRounds}` : ''}</span>}
        <span className="live-strip__score"><span className="dot dot--a" />{d.scoreA}<span className="live-strip__dash">–</span>{d.scoreB}<span className="dot dot--b" /></span>
      </div>
      {d.speakerName && d.phase !== 'ENDED' && (
        <p className="live-strip__line"><span className={`dot dot--${speakerSide === 1 ? 'b' : 'a'}`} />{d.speakerName} has the floor</p>
      )}
      {d.roundClaim && <p className="live-strip__claim">“{d.roundClaim}”</p>}
      {d.phase !== 'ENDED' && (
        <button className="btn btn--ghost btn--sm live-strip__board" onClick={() => navigate(`/board/${roomId}`)}>Live board</button>
      )}
    </div>
  );
}
