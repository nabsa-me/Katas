import { Client } from 'pg';
import { LOCAL_DATABASE_URL } from './lib/postgres';

/**
 * Vitest global setup: the integration tests query the Postgres from `docker-compose.yml`, so the run stops at once
 * with the command to type instead of failing test by test with connection errors.
 */
export default async function requirePostgres(): Promise<void> {
  const client = new Client({ connectionString: LOCAL_DATABASE_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM issues LIMIT 1');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Postgres is not answering on 127.0.0.1:5809 (${reason}). Start Postgres first: docker compose up -d --wait`,
      { cause: error },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
