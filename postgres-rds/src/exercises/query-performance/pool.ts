import { Pool } from 'pg';

export interface ConnectionBudget {
  /** `SHOW max_connections` on the instance (on RDS it depends on the instance class's memory). */
  maxConnections: number;
  /** Kept free for admins, migrations, monitoring and superuser_reserved_connections. */
  reservedConnections: number;
  /** The most application instances that can run at once, including both colours during a deploy. */
  instances: number;
}

/**
 * Connections per instance so that every instance with a full pool still fits in the database's budget.
 * More is not faster: past the database's CPU and I/O capacity, extra connections only queue inside it.
 */
export function poolSizePerInstance({ maxConnections, reservedConnections, instances }: ConnectionBudget): number {
  const values = [maxConnections, reservedConnections, instances];
  if (!values.every(Number.isInteger) || maxConnections < 1 || reservedConnections < 0 || instances < 1) {
    throw new Error('The connection budget needs positive whole numbers');
  }
  const perInstance = Math.floor((maxConnections - reservedConnections) / instances);
  if (perInstance < 1) {
    throw new Error(`${instances} instances do not fit in ${maxConnections - reservedConnections} connections`);
  }
  return perInstance;
}

/** The application's pool, sized from the budget, with the timeouts a production service needs. */
export function createPool(connectionString: string, budget: ConnectionBudget): Pool {
  return new Pool({
    connectionString,
    max: poolSizePerInstance(budget),
    // A request waits at most 2 s for a free connection, then fails, instead of queueing forever.
    connectionTimeoutMillis: 2_000,
    // Idle connections are closed after 30 s, so a quiet instance gives them back.
    idleTimeoutMillis: 30_000,
    // Connections are recycled every 30 min, so none stays attached to an old host after a DNS change.
    maxLifetimeSeconds: 30 * 60,
    // The server cancels any statement running longer than 5 s.
    statement_timeout: 5_000,
    // Shows up in pg_stat_activity, so a slow query can be traced to its service.
    application_name: 'issues-api',
  });
}
