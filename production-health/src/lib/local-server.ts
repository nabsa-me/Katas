import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LocalServer {
  /** Base URL, such as `http://127.0.0.1:53124`. */
  url: string;
  close(): Promise<void>;
}

/**
 * Starts a real `node:http` server on 127.0.0.1 and a free port chosen by the OS (port 0), so tests exercise the
 * handlers over HTTP (headers, status codes, concurrent requests) without taking the service's fixed port.
 */
export async function startLocalServer(handler: RequestListener): Promise<LocalServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
