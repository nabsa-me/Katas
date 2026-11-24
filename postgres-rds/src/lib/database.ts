import { randomBytes } from 'node:crypto';
import { Client, DatabaseError, escapeIdentifier, Pool, type QueryResult, type QueryResultRow } from 'pg';

/**
 * Admin connection to the Postgres started by `docker-compose.yml` (host port 5807). The password is the
 * local-only one from the compose file. `DATABASE_ADMIN_URL` overrides it, for example in CI.
 */
export const adminConnectionString =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5807/postgres';

export const START_POSTGRES_HINT = 'Start Postgres first: docker compose up -d --wait';

/** The part of `pg` that runs queries: a pool, a pooled client or a single client all fit. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export interface TemporaryDatabase {
  name: string;
  connectionString: string;
  pool: Pool;
  /** Closes the pool and drops the database, even if other sessions are still connected. */
  drop(): Promise<void>;
}

/** Eight hex characters: enough to keep parallel test files (and their cluster-wide roles) apart. */
export function randomSuffix(): string {
  return randomBytes(4).toString('hex');
}

/** The same server and credentials, another database. */
export function connectionStringFor(database: string, base = adminConnectionString): string {
  const url = new URL(base);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

/** Runs `work` with a short-lived client and always closes it. */
export async function withClient<T>(connectionString: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates `<prefix>_<random suffix>` so every test file works in its own database and can run in
 * parallel with the others. Drop it in `afterAll`.
 */
export async function createTemporaryDatabase(prefix: string): Promise<TemporaryDatabase> {
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) throw new Error(`Invalid database prefix: ${prefix}`);
  const name = `${prefix}_${randomSuffix()}`;
  await withClient(adminConnectionString, (admin) => admin.query(`CREATE DATABASE ${escapeIdentifier(name)}`));
  const connectionString = connectionStringFor(name);
  const pool = new Pool({ connectionString, max: 4 });
  return {
    name,
    connectionString,
    pool,
    async drop() {
      await pool.end();
      await dropDatabase(name);
    },
  };
}

/** `WITH (FORCE)` (Postgres 13+) terminates the sessions still connected instead of failing. */
export async function dropDatabase(name: string): Promise<void> {
  await withClient(adminConnectionString, (admin) =>
    admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(name)} WITH (FORCE)`),
  );
}

/**
 * Awaits `work` and returns the SQLSTATE it failed with (`'23505'`, `'42501'`…), or `'none'` if it
 * succeeded. Errors that do not come from the server are rethrown.
 */
export async function sqlStateOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return 'none';
  } catch (error) {
    if (error instanceof DatabaseError && error.code) return error.code;
    throw error;
  }
}
