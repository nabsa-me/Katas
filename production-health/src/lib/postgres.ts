import { Pool } from 'pg';

/** The Postgres from `docker-compose.yml`. Local-only credentials of a throwaway container. */
export const LOCAL_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5809/production_health';

export interface PoolSettings {
  connectionString: string;
  /** Shown in `pg_stat_activity.application_name`, so whoever looks at the database sees who holds each connection. */
  applicationName: string;
  /** Receives the errors of idle connections (a restart, a failover, a terminated backend). Mandatory on purpose. */
  onError: (error: Error) => void;
  /** Connections this process may open. Instances × `max` must stay below the server's `max_connections`. */
  max?: number;
  /** How long to wait for a connection, from the pool or a new one, before failing instead of queueing forever. */
  connectionTimeoutMillis?: number;
  /** Idle connections are closed after this long, so a quiet instance gives its connections back. */
  idleTimeoutMillis?: number;
  /** Server side: Postgres cancels a statement that runs longer (SQLSTATE 57014) and frees its resources. */
  statementTimeoutMs?: number;
  /** Client side: the query fails if no answer arrives, even when the server or the network is gone. */
  queryTimeoutMs?: number;
}

/**
 * A `pg.Pool` with every limit explicit. The defaults of `pg` are no connection timeout, no statement timeout and
 * no `error` listener: a request waits forever for a saturated pool, and a dropped idle connection emits `error` on
 * an EventEmitter with nobody listening, which Node turns into an uncaught exception that ends the process.
 */
export function createPool({
  connectionString,
  applicationName,
  onError,
  max = 10,
  connectionTimeoutMillis = 2_000,
  idleTimeoutMillis = 30_000,
  statementTimeoutMs = 2_000,
  queryTimeoutMs = 3_000,
}: PoolSettings): Pool {
  const pool = new Pool({
    connectionString,
    application_name: applicationName,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    statement_timeout: statementTimeoutMs,
    query_timeout: queryTimeoutMs,
  });
  pool.on('error', onError);
  return pool;
}
