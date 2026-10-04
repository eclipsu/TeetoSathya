import { useMemo, type ReactNode } from 'react';
import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from '../module_bindings';

/** Public Maincloud settings. Empty database name means the browser does not connect. */
export const hostedSpacetimeDatabase = (import.meta.env.VITE_SPACETIMEDB_DATABASE ?? '').trim();
const hostedUri = (import.meta.env.VITE_SPACETIMEDB_URI || 'https://maincloud.spacetimedb.com').trim();

export function HostedSpacetimeProvider({ children }: { children: ReactNode }) {
  const connectionBuilder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(hostedUri)
        .withDatabaseName(hostedSpacetimeDatabase)
        .withLightMode(true),
    [],
  );
  if (!hostedSpacetimeDatabase) return children;
  return <SpacetimeDBProvider connectionBuilder={connectionBuilder}>{children}</SpacetimeDBProvider>;
}

/**
 * Subscribes only to this room. Renders nothing: Socket.IO snapshots are still
 * what the room UI draws, so this must not show a second score.
 */
export function HostedRoomSubscription({ roomId }: { roomId: string }) {
  const [games] = useTable(tables.gameState.where((row) => row.roomId.eq(roomId)));
  const roundId = games[0]?.roundId ?? '';
  useTable(tables.participant.where((row) => row.roomId.eq(roomId)));
  useTable(tables.speakerQueue.where((row) => row.roundId.eq(roundId)), { enabled: roundId.length > 0 });
  useTable(tables.factCheck.where((row) => row.roomId.eq(roomId)));
  useTable(tables.claim.where((row) => row.roomId.eq(roomId)));
  useTable(tables.transcriptSegment.where((row) => row.roomId.eq(roomId)));
  return null;
}
