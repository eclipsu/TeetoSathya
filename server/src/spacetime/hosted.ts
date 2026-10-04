import { config } from '../config';
import { DbConnection } from '../module_bindings/index';

let ready: Promise<DbConnection | null> = Promise.resolve(null);

/**
 * Connects Node to hosted Maincloud when SPACETIMEDB_DATABASE is set.
 * The connection is the database owner, so it can record debate history.
 */
export function connectHostedSpacetime(): void {
  const database = config.spacetimeDatabase.trim();
  if (!database) {
    console.log('[spacetime] hosted database name is unset; debate history is not recorded');
    ready = Promise.resolve(null);
    return;
  }
  ready = new Promise((resolve) => {
    let settled = false;
    const finish = (conn: DbConnection | null) => {
      if (settled) return;
      settled = true;
      resolve(conn);
    };
    const builder = DbConnection.builder()
      .withUri(config.spacetimeUri)
      .withDatabaseName(database)
      .onConnect((conn) => {
        console.log(`[spacetime] connected to ${config.spacetimeUri} database ${database}`);
        finish(conn);
      })
      .onConnectError((_ctx, error) => {
        console.warn('[spacetime] hosted connect failed:', error instanceof Error ? error.message : 'connect error');
        finish(null);
      });
    if (config.spacetimeToken) builder.withToken(config.spacetimeToken);
    else console.warn('[spacetime] SPACETIMEDB_TOKEN is unset; history reducers will be rejected');
    builder.build();
  });
}

export function spacetimeConnection(): Promise<DbConnection | null> {
  return ready;
}
