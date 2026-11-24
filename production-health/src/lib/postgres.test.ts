import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool, LOCAL_DATABASE_URL } from './postgres';

const pools: Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

function testPool(settings: { onError?: (error: Error) => void; statementTimeoutMs?: number } = {}) {
  const applicationName = `postgres-test-${randomUUID()}`;
  const pool = createPool({
    connectionString: LOCAL_DATABASE_URL,
    applicationName,
    onError: settings.onError ?? (() => {}),
    statementTimeoutMs: settings.statementTimeoutMs,
  });
  pools.push(pool);
  return { pool, applicationName };
}

describe('createPool', () => {
  it('reaches the seeded database: 3,000 fictional issues in three statuses', async () => {
    const { pool } = testPool();
    const { rows } = await pool.query<{ status: string; total: number }>(
      'SELECT status, count(*)::int AS total FROM issues GROUP BY status ORDER BY status',
    );
    expect(rows).toEqual([
      { status: 'done', total: 1000 },
      { status: 'in_progress', total: 1000 },
      { status: 'todo', total: 1000 },
    ]);
  });

  it('names its connections, so they can be told apart in pg_stat_activity', async () => {
    const { pool, applicationName } = testPool();
    const { rows } = await pool.query<{ name: string }>('SELECT current_setting($1) AS name', ['application_name']);
    expect(rows[0]?.name).toBe(applicationName);
  });

  it('lets Postgres cancel a statement that runs past the statement timeout', async () => {
    const { pool } = testPool({ statementTimeoutMs: 100 });
    await expect(pool.query('SELECT pg_sleep(1)')).rejects.toMatchObject({ code: '57014' });
  });

  it('reports an idle connection killed by the server to onError, and keeps working', async () => {
    const onError = vi.fn();
    const { pool, applicationName } = testPool({ onError });
    await pool.query('SELECT 1'); // leaves one idle connection in the pool

    // What a restart or a failover does to every open connection, done to just this one.
    const { pool: admin } = testPool();
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [
      applicationName,
    ]);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    // The broken connection was discarded; the next query opens a new one.
    await expect(pool.query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
  });
});
