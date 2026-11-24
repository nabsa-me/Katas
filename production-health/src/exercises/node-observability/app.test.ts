import type { RequestListener } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../../lib/local-server';
import { createApp } from './app';
import { createProblemApp } from './app.problem';
import { emfProblems, type EmfEvent } from './emf';
import { createHealth, type DatabaseProbe } from './health';
import type { Issue, IssueRepository } from './issues';
import { createLogger } from './logger';

const ISSUE: Issue = {
  key: 'PLAT-7',
  title: 'Fix a flaky test in the issues API',
  status: 'todo',
  assignee: 'Laia Puig',
  updatedAt: '2026-10-01T09:31:00.000Z',
};

let local: LocalServer | undefined;
afterEach(async () => {
  await local?.close();
  local = undefined;
  vi.restoreAllMocks();
});

async function serve(handler: RequestListener): Promise<string> {
  local = await startLocalServer(handler);
  return local.url;
}

/** A promise the test resolves by hand, to hold a request in the middle of its work. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

const healthyDatabase: DatabaseProbe = { name: 'postgres', check: async () => {} };

/** The solution wired with stubs: log lines, metrics and reported errors are collected instead of printed. */
function setup({ issues, database = healthyDatabase }: { issues?: IssueRepository; database?: DatabaseProbe } = {}) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger('debug', { write: (line: string) => void lines.push(JSON.parse(line)) });
  const metrics: EmfEvent[] = [];
  const reportError = vi.fn();
  const app = createApp({
    issues: issues ?? { list: async () => [ISSUE], get: async (key) => (key === ISSUE.key ? ISSUE : undefined) },
    health: createHealth({ database, timeoutMs: 200 }),
    logger,
    emitMetrics: (event) => metrics.push(event),
    reportError,
  });
  return { app, logger, lines, metrics, reportError };
}

describe('flawed app', () => {
  it('answers 200 with an empty list when the database fails, so the outage looks like "no issues"', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing: IssueRepository = { list: () => Promise.reject(new Error('connect ECONNREFUSED')), get: vi.fn() };
    const url = await serve(createProblemApp(failing));

    const response = await fetch(`${url}/issues?status=todo`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ issues: [] });
  });

  it('has no health checks, so an orchestrator can only check that the port is open', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const url = await serve(createProblemApp({ list: async () => [], get: async () => undefined }));
    expect((await fetch(`${url}/healthz`)).status).toBe(404);
    expect((await fetch(`${url}/readyz`)).status).toBe(404);
  });

  it('logs free text that cannot be traced back to a request when requests overlap', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const url = await serve(createProblemApp({ list: async () => [], get: async () => undefined }));

    const responses = await Promise.all([fetch(`${url}/issues?status=todo`), fetch(`${url}/issues?status=done`)]);
    expect(responses.every((response) => !response.headers.has('x-correlation-id'))).toBe(true);

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line === 'Found 0 issues')).toHaveLength(2); // whose is which?
    expect(() => JSON.parse(lines[0] ?? '')).toThrow();
  });
});

describe('solution app', () => {
  it('writes the correlation id of its request on every log line, with requests interleaved', async () => {
    const gates = { todo: deferred(), done: deferred() };
    const { app, logger, lines } = setup({
      issues: {
        // Knows nothing about requests, yet its lines carry the right id: the logger's mixin finds it.
        list: async ({ status }) => {
          logger.debug({ status }, 'query sent');
          await (status === 'todo' ? gates.todo : gates.done).promise;
          logger.debug({ status }, 'rows received');
          return [];
        },
        get: async () => undefined,
      },
    });
    const url = await serve(app);

    const first = fetch(`${url}/issues?status=todo`, { headers: { 'x-correlation-id': 'request-a' } });
    const second = fetch(`${url}/issues?status=done`, { headers: { 'x-correlation-id': 'request-b' } });
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    gates.done.resolve(); // the second request finishes first
    await vi.waitFor(() => expect(lines).toHaveLength(4));
    gates.todo.resolve();
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.headers.get('x-correlation-id'))).toEqual(['request-a', 'request-b']);
    expect(lines.map((line) => [line.correlationId, line.msg])).toEqual([
      ['request-a', 'query sent'],
      ['request-b', 'query sent'],
      ['request-b', 'rows received'],
      ['request-b', 'request done'],
      ['request-a', 'rows received'],
      ['request-a', 'request done'],
    ]);
  });

  it('creates a correlation id when the caller sends none or an unsafe one', async () => {
    const { app, lines } = setup();
    const url = await serve(app);

    const missing = await fetch(`${url}/healthz`);
    const unsafe = await fetch(`${url}/healthz`, { headers: { 'x-correlation-id': 'x'.repeat(500) } });

    for (const response of [missing, unsafe]) {
      expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(lines.map((line) => line.correlationId)).toEqual([
      missing.headers.get('x-correlation-id'),
      unsafe.headers.get('x-correlation-id'),
    ]);
  });

  it('answers /healthz without touching the database, and /readyz 503 when the database is down', async () => {
    const database: DatabaseProbe = {
      name: 'postgres',
      check: vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED 10.0.4.7:5432'))),
    };
    const { app, lines } = setup({ database });
    const url = await serve(app);

    const live = await fetch(`${url}/healthz`);
    expect(live.status).toBe(200);
    expect(database.check).not.toHaveBeenCalled();

    const ready = await fetch(`${url}/readyz`);
    const text = await ready.text();
    expect(ready.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      status: 'not_ready',
      checks: [{ name: 'postgres', ok: false, durationMs: expect.any(Number) }],
    });
    expect(text).not.toContain('10.0.4.7'); // the reason is logged, not published
    expect(lines.find((line) => line.msg === 'not ready')).toMatchObject({
      level: 'warn',
      readiness: { checks: [{ error: 'connect ECONNREFUSED 10.0.4.7:5432' }] },
    });
  });

  it('turns an unexpected error into a 500 with the correlation id, a logged stack and one report', async () => {
    const failure = new Error('Connection terminated unexpectedly');
    const { app, lines, reportError, metrics } = setup({
      issues: { list: () => Promise.reject(failure), get: async () => undefined },
    });
    const url = await serve(app);

    const response = await fetch(`${url}/issues?status=todo`, { headers: { 'x-correlation-id': 'request-c' } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error', correlationId: 'request-c' });
    expect(lines.find((line) => line.msg === 'request failed')).toMatchObject({
      level: 'error',
      correlationId: 'request-c',
      route: '/issues',
      err: { message: 'Connection terminated unexpectedly', stack: expect.stringContaining('Error:') },
    });
    expect(reportError).toHaveBeenCalledExactlyOnceWith(failure, 'request-c');
    expect(metrics[0]).toMatchObject({ Route: '/issues', Errors: 1, StatusCode: 500 });
  });

  it('emits one valid EMF event per request, named by route template, never by path', async () => {
    const { app, metrics } = setup();
    const url = await serve(app);

    await fetch(`${url}/issues/PLAT-7`);
    await fetch(`${url}/issues/PLAT-8`);
    await fetch(`${url}/wp-admin/install.php`);

    expect(metrics.map((event) => [event.Route, event.StatusCode, event.Errors])).toEqual([
      ['/issues/:key', 200, 0],
      ['/issues/:key', 404, 0],
      ['unmatched', 404, 0],
    ]);
    expect(metrics.flatMap(emfProblems)).toEqual([]);
  });

  it('validates input before it reaches the repository', async () => {
    const issues = { list: vi.fn(async () => []), get: vi.fn(async () => undefined) };
    const { app } = setup({ issues });
    const url = await serve(app);

    expect((await fetch(`${url}/issues?status=archived`)).status).toBe(400);
    expect((await fetch(`${url}/issues?status=todo&limit=5000`)).status).toBe(400);
    expect((await fetch(`${url}/issues/PLAT-1%27%20OR%201=1`)).status).toBe(400);
    expect((await fetch(`${url}/issues`, { method: 'POST' })).status).toBe(405);
    expect(issues.list).not.toHaveBeenCalled();
    expect(issues.get).not.toHaveBeenCalled();

    expect(await (await fetch(`${url}/issues?status=todo`)).json()).toEqual({ issues: [] });
    expect(issues.list).toHaveBeenCalledWith({ status: 'todo', limit: 20 });
  });
});
