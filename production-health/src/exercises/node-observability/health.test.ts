import { describe, expect, it, vi } from 'vitest';
import { createHealth, type DatabaseProbe } from './health';

const probe = (check: () => Promise<void>): DatabaseProbe => ({ name: 'postgres', check: vi.fn(check) });

describe('createHealth', () => {
  it('reports liveness without running any check', () => {
    const database = probe(async () => {});
    expect(createHealth({ database, timeoutMs: 100 }).liveness()).toEqual({ status: 'ok' });
    expect(database.check).not.toHaveBeenCalled();
  });

  it('is ready when the database check passes', async () => {
    const health = createHealth({ database: probe(async () => {}), timeoutMs: 100 });
    expect(await health.readiness()).toEqual({
      status: 'ready',
      checks: [{ name: 'postgres', ok: true, durationMs: expect.any(Number) }],
    });
  });

  it('is not ready when the check fails, and keeps the reason for the logs', async () => {
    const health = createHealth({
      database: probe(() => Promise.reject(new Error('password authentication failed'))),
      timeoutMs: 100,
    });
    expect(await health.readiness()).toMatchObject({
      status: 'not_ready',
      checks: [{ name: 'postgres', ok: false, error: 'password authentication failed' }],
    });
  });

  it('treats a check that hangs as failed once the timeout passes', async () => {
    const health = createHealth({ database: probe(() => new Promise(() => {})), timeoutMs: 50 });
    const started = performance.now();
    expect(await health.readiness()).toMatchObject({
      status: 'not_ready',
      checks: [{ ok: false, error: 'no answer after 50 ms' }],
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('recovers on its own: readiness is evaluated on every call', async () => {
    let up = false;
    const database = probe(() => (up ? Promise.resolve() : Promise.reject(new Error('down'))));
    const health = createHealth({ database, timeoutMs: 100 });

    expect((await health.readiness()).status).toBe('not_ready');
    up = true;
    expect((await health.readiness()).status).toBe('ready');
  });

  it('stops being ready while draining, without asking the database', async () => {
    const database = probe(async () => {});
    const health = createHealth({ database, timeoutMs: 100 });
    health.startDraining();
    expect(await health.readiness()).toEqual({ status: 'draining', checks: [] });
    expect(database.check).not.toHaveBeenCalled();
    expect(health.liveness()).toEqual({ status: 'ok' }); // alive: it is finishing its requests
  });
});
