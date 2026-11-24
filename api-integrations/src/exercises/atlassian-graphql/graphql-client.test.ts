import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGraphqlClient, GraphqlHttpError, retryAfterDelayMs, type GraphqlClientOptions } from './graphql-client';

const ENDPOINT = 'https://katas-example.atlassian.net/gateway/api/graphql';
const NOW = Date.parse('2026-11-24T10:00:00Z');
const QUERY = 'query Me { me { user { name } } }';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Answers the scripted responses in order, then `{ data: { ok: true } }`. */
function setup(responses: (() => Response)[], options: Partial<GraphqlClientOptions> = {}) {
  let requests = 0;
  server.use(
    http.post(ENDPOINT, () => {
      const next = responses[requests++];
      return next ? next() : HttpResponse.json({ data: { ok: true } });
    }),
  );
  const sleeps: number[] = [];
  const client = createGraphqlClient({
    endpoint: ENDPOINT,
    authorization: 'Basic replace-with-base64-credentials',
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return { client, sleeps, requestCount: () => requests };
}

const rateLimited = (retryAfter: string) => () =>
  new HttpResponse(null, { status: 429, headers: { 'RETRY-AFTER': retryAfter } });

describe('createGraphqlClient', () => {
  it('returns data and errors together, without throwing', async () => {
    const body = { data: { me: null }, errors: [{ message: 'Forbidden', path: ['me'] }] };
    const { client } = setup([() => HttpResponse.json(body)]);
    expect(await client.execute(QUERY)).toEqual(body);
  });

  it('returns a GraphQL envelope even when the HTTP status is an error', async () => {
    const body = {
      errors: [{ message: 'Validation error: field "nope" is undefined', locations: [{ line: 1, column: 3 }] }],
    };
    const { client } = setup([() => HttpResponse.json(body, { status: 400 })]);
    expect(await client.execute(QUERY)).toEqual({ data: null, errors: body.errors });
  });

  it('waits until the RETRY-AFTER timestamp on a 429, then retries', async () => {
    const { client, sleeps, requestCount } = setup([rateLimited('2026-11-24T10:00:30Z')]);
    expect(await client.execute(QUERY)).toEqual({ data: { ok: true }, errors: [] });
    expect(sleeps).toEqual([30_000]);
    expect(requestCount()).toBe(2);
  });

  it('gives up after the last attempt while still rate limited', async () => {
    const { client, sleeps } = setup([rateLimited('5'), rateLimited('5'), rateLimited('5')]);
    await expect(client.execute(QUERY)).rejects.toMatchObject({ name: 'GraphqlHttpError', status: 429 });
    expect(sleeps).toEqual([5000, 5000]);
  });

  it('gives up when the server asks for a longer wait than the client accepts', async () => {
    const { client, sleeps } = setup([rateLimited('2026-11-24T11:00:00Z')]);
    await expect(client.execute(QUERY)).rejects.toBeInstanceOf(GraphqlHttpError);
    expect(sleeps).toEqual([]);
  });

  it('throws on a response that is not GraphQL, such as an authentication failure', async () => {
    const { client } = setup([() => new HttpResponse('Unauthorized', { status: 401 })]);
    await expect(client.execute(QUERY)).rejects.toMatchObject({ status: 401, message: /Unauthorized/ });
  });

  it('does not retry a 5xx', async () => {
    const { client, requestCount } = setup([() => new HttpResponse('<html>Bad gateway</html>', { status: 502 })]);
    await expect(client.execute(QUERY)).rejects.toMatchObject({ status: 502 });
    expect(requestCount()).toBe(1);
  });
});

describe('retryAfterDelayMs', () => {
  it('reads the ISO 8601 timestamp the Atlassian gateway sends, with or without seconds', () => {
    expect(retryAfterDelayMs('2026-11-24T10:01Z', NOW)).toBe(60_000);
    expect(retryAfterDelayMs('2026-11-24T10:00:15Z', NOW)).toBe(15_000);
  });

  it('also accepts the two standard HTTP forms: seconds and an HTTP date', () => {
    expect(retryAfterDelayMs('7', NOW)).toBe(7000);
    expect(retryAfterDelayMs('Tue, 24 Nov 2026 10:00:20 GMT', NOW)).toBe(20_000);
  });

  it('never returns a negative wait for a moment already past', () => {
    expect(retryAfterDelayMs('2026-11-24T09:00Z', NOW)).toBe(0);
  });

  it('returns null when the header is missing or unreadable', () => {
    expect(retryAfterDelayMs(null, NOW)).toBeNull();
    expect(retryAfterDelayMs('later', NOW)).toBeNull();
  });
});
