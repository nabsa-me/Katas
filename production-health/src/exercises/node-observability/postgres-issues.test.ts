import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import type { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createPool, LOCAL_DATABASE_URL } from '../../lib/postgres';
import { runWithContext } from './context';
import { createHealth } from './health';
import { createLogger, logIdleConnectionError } from './logger';
import { createPostgresIssueRepository, createPostgresProbe } from './postgres-issues';

const pools: Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

function pool(connectionString = LOCAL_DATABASE_URL, onError: (error: Error) => void = () => {}) {
  const created = createPool({
    connectionString,
    applicationName: `issues-test-${randomUUID()}`,
    connectionTimeoutMillis: 300,
    onError,
  });
  pools.push(created);
  return created;
}

function collectingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger('debug', { write: (line: string) => void lines.push(JSON.parse(line)) });
  return { logger, lines };
}

/** Accepts TCP connections and never answers: a database host that is up at the network level and hung. */
const sockets: Socket[] = [];
const silentServer: Server = createServer((socket) => void sockets.push(socket));
afterAll(() => {
  sockets.forEach((socket) => socket.destroy());
  silentServer.close();
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('Postgres issue repository', () => {
  it('lists the newest issues of a status and finds one by key', async () => {
    const { logger } = collectingLogger();
    const issues = createPostgresIssueRepository(pool(), logger);

    const latest = await issues.list({ status: 'done', limit: 3 });
    expect(latest.map((issue) => issue.key)).toEqual(['PLAT-2999', 'PLAT-2996', 'PLAT-2993']);
    expect(await issues.get('PLAT-7')).toEqual({
      key: 'PLAT-7',
      title: 'Fix a flaky test in the issues API',
      status: 'in_progress',
      assignee: 'Laia Puig',
      updatedAt: '2026-10-01T09:31:00.000Z',
    });
    expect(await issues.get('PLAT-999999')).toBeUndefined();
  });

  it('logs each query with the correlation id of the request that runs it', async () => {
    const { logger, lines } = collectingLogger();
    const issues = createPostgresIssueRepository(pool(), logger);

    await runWithContext({ correlationId: 'request-d' }, () => issues.get('PLAT-1'));

    expect(lines).toEqual([expect.objectContaining({ correlationId: 'request-d', query: 'issues.get', rows: 1 })]);
  });
});

describe('Postgres readiness probe', () => {
  it('passes while Postgres answers', async () => {
    const health = createHealth({ database: createPostgresProbe(pool()), timeoutMs: 1_000 });
    expect(await health.readiness()).toMatchObject({ status: 'ready', checks: [{ name: 'postgres', ok: true }] });
  });

  it('fails at once when nothing listens on the port', async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const health = createHealth({
      database: createPostgresProbe(pool(`postgres://postgres:postgres@127.0.0.1:${port}/production_health`)),
      timeoutMs: 1_000,
    });

    const readiness = await health.readiness();
    expect(readiness).toMatchObject({
      status: 'not_ready',
      checks: [{ ok: false, error: expect.stringMatching(/ECONNREFUSED/) }],
    });
  });

  it('fails within the connection timeout when the host accepts the connection and never answers', async () => {
    const port = await listen(silentServer);
    const health = createHealth({
      database: createPostgresProbe(pool(`postgres://postgres:postgres@127.0.0.1:${port}/production_health`)),
      timeoutMs: 2_000,
    });

    const readiness = await health.readiness();
    expect(readiness).toMatchObject({
      status: 'not_ready',
      checks: [{ ok: false, error: expect.stringMatching(/timeout/i) }],
    });
    expect(readiness.checks[0]?.durationMs).toBeLessThan(1_000); // the pool's 300 ms, not the 2 s safety net
  });
});

describe('idle connection errors', () => {
  async function killIdleConnectionOpenedByARequest(onError: (error: Error) => void) {
    const appPool = pool(LOCAL_DATABASE_URL, onError);
    // A request opens the connection; it stays idle in the pool afterwards.
    await runWithContext({ correlationId: 'request-e' }, () => appPool.query('SELECT 1'));
    const { rows } = await appPool.query<{ name: string }>('SELECT current_setting($1) AS name', ['application_name']);
    await pool().query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [
      rows[0]?.name,
    ]);
  }

  it('would be blamed on the request that opened the connection, minutes earlier', async () => {
    const { logger, lines } = collectingLogger();
    await killIdleConnectionOpenedByARequest((error) =>
      logger.error({ err: error }, 'idle database connection failed'),
    );
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(lines[0]).toMatchObject({ correlationId: 'request-e' });
  });

  it('are logged outside any request context', async () => {
    const { logger, lines } = collectingLogger();
    await killIdleConnectionOpenedByARequest(logIdleConnectionError(logger));
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'idle database connection failed' });
    expect(lines[0]).not.toHaveProperty('correlationId');
  });
});
