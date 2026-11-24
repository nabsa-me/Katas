import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startLocalServer, type LocalServer } from '../../lib/local-server';
import { checkServiceReady, K6_IMAGE, k6DockerArgs } from './k6-docker';

describe('k6DockerArgs', () => {
  it('runs the pinned k6 image on a script read from stdin, with the host reachable', () => {
    expect(k6DockerArgs({ baseUrl: 'http://host.docker.internal:5808' })).toEqual([
      'run',
      '--rm',
      '-i',
      '--add-host=host.docker.internal:host-gateway',
      '-e',
      'BASE_URL=http://host.docker.internal:5808',
      'grafana/k6:2.4.0',
      'run',
      '-',
    ]);
    expect(K6_IMAGE).toMatch(/^grafana\/k6:\d+\.\d+\.\d+$/);
  });

  it('passes extra k6 options before the script', () => {
    const args = k6DockerArgs({ baseUrl: 'http://example.test', k6Args: ['--summary-mode=full'] });
    expect(args.slice(-3)).toEqual(['run', '--summary-mode=full', '-']);
  });
});

describe('checkServiceReady', () => {
  let local: LocalServer | undefined;
  afterEach(async () => {
    await local?.close();
    local = undefined;
  });

  it('accepts a service whose /readyz answers 200', async () => {
    local = await startLocalServer((req, res) => res.writeHead(req.url === '/readyz' ? 200 : 404).end());
    expect(await checkServiceReady(local.url)).toEqual({ ok: true });
  });

  it('rejects a service that is up but not ready', async () => {
    local = await startLocalServer((_, res) => res.writeHead(503).end());
    expect(await checkServiceReady(local.url)).toEqual({ ok: false, reason: '/readyz answered 503' });
  });

  it('explains why when nothing listens', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));

    expect(await checkServiceReady(`http://127.0.0.1:${port}`)).toEqual({
      ok: false,
      reason: expect.stringMatching(/ECONNREFUSED/),
    });
  });
});
