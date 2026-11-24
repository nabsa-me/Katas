import { createServer, type ServerHttp2Session } from 'node:http2';
import type { AddressInfo } from 'node:net';

/** A scripted reply: a JSON response, or `'stall'` to accept the request and never answer it. */
export type FakeReply = { status: number; body: unknown; headers?: Record<string, string> } | 'stall';

export interface RecordedRequest {
  path: string;
  body: unknown;
}

/** Fake static credentials for signing requests to the fake server. Not a real key format. */
export const FAKE_CREDENTIALS = {
  accessKeyId: 'replace-with-a-fake-key-id',
  secretAccessKey: 'replace-with-a-fake-secret',
};

/** A successful Converse response body, as Bedrock serializes it on the wire. */
export function converseReply(text: string, stopReason = 'end_turn'): FakeReply {
  return {
    status: 200,
    body: {
      output: { message: { role: 'assistant', content: [{ text }] } },
      stopReason,
      usage: { inputTokens: 25, outputTokens: 8, totalTokens: 33 },
      metrics: { latencyMs: 140 },
    },
  };
}

/** An error response as Bedrock sends it: the status, the error type header and a message. */
export function errorReply(status: number, errorType: string, message: string): FakeReply {
  return { status, headers: { 'x-amzn-errortype': errorType }, body: { message } };
}

/**
 * A local HTTP/2 server without TLS (h2c) that answers like Bedrock Runtime, one scripted reply per request (the
 * last reply repeats). The real `BedrockRuntimeClient` and its `NodeHttp2Handler` talk to it unchanged, so retries,
 * backoff and timeouts are the SDK's own, not a mock's.
 */
export async function startFakeBedrock(replies: FakeReply[]) {
  const requests: RecordedRequest[] = [];
  const sessions = new Set<ServerHttp2Session>();
  const server = createServer();

  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
  });
  server.on('stream', (stream, headers) => {
    let raw = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => (raw += chunk));
    stream.on('error', () => {}); // the client resets the stream when it gives up
    stream.on('end', () => {
      requests.push({ path: String(headers[':path']), body: raw ? JSON.parse(raw) : undefined });
      const reply = replies[requests.length - 1] ?? replies.at(-1);
      if (!reply || reply === 'stall') return; // only the client's timeout can end this request
      stream.respond({ ':status': reply.status, 'content-type': 'application/json', ...reply.headers });
      stream.end(JSON.stringify(reply.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const session of sessions) session.destroy();
        server.close(() => resolve());
      }),
  };
}
