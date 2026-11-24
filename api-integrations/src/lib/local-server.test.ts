import { describe, expect, it } from 'vitest';
import { startLocalServer } from './local-server';

describe('startLocalServer', () => {
  it('serves the handler on a free local port and closes', async () => {
    const server = await startLocalServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`${req.method} ${req.url}`);
    });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${server.url}/hello`);
    expect(await response.text()).toBe('GET /hello');

    await server.close();
    await expect(fetch(`${server.url}/hello`)).rejects.toThrow();
  });
});
