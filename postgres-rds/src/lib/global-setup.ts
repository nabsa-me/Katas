import { Client } from 'pg';
import { adminConnectionString, START_POSTGRES_HINT } from './database';

/**
 * Vitest global setup: every exercise talks to a real Postgres. Without one, fail once with the
 * command to run instead of a timeout in every test file.
 */
export default async function checkPostgres(): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    const where = new URL(adminConnectionString).host;
    throw new Error(`Postgres is not reachable at ${where}. ${START_POSTGRES_HINT}`, { cause: error });
  } finally {
    await client.end().catch(() => undefined);
  }
}
