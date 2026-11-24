import { createHmac, randomUUID } from 'node:crypto';
import type { RequestListener } from 'node:http';
import { Octokit } from '@octokit/rest';
import { passthrough } from 'msw';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pullRequestOpened from '../../data/pull-request-opened.json';
import { createBackgroundTasks } from '../../lib/background-tasks';
import { startLocalServer, type LocalServer } from '../../lib/local-server';
import { createInMemoryDeliveryStore } from './delivery-store';
import { createPullRequestOpenedProcessor, reviewChecklist } from './pull-request-opened';
import { createWebhookHandler } from './webhook-handler';
import { createWebhookHandler as createFlawedHandler } from './webhook-handler.problem';

const SECRET = 'replace-with-the-webhook-secret';
const COMMENTS_URL = 'https://api.github.com/repos/:owner/:repo/issues/:issueNumber/comments';

const mswServer = setupServer();
beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

let local: LocalServer | undefined;
afterEach(async () => {
  await local?.close();
  local = undefined;
});

/** Serves `handler` on a local port and lets those requests through msw. */
async function serve(handler: RequestListener): Promise<string> {
  local = await startLocalServer(handler);
  mswServer.use(http.all(`${local.url}/*`, () => passthrough()));
  return `${local.url}/github/webhooks`;
}

/** The fake GitHub REST API: records every comment created. */
function captureComments() {
  const comments: { path: string; body: unknown }[] = [];
  mswServer.use(
    http.post(COMMENTS_URL, async ({ request, params }) => {
      comments.push({
        path: `${params.owner}/${params.repo}#${params.issueNumber}`,
        body: ((await request.json()) as { body: unknown }).body,
      });
      return HttpResponse.json({ id: comments.length }, { status: 201 });
    }),
  );
  return comments;
}

function octokit(): Octokit {
  const silent = () => {};
  return new Octokit({
    auth: 'replace-with-an-installation-token',
    log: { debug: silent, info: silent, warn: silent, error: silent },
  });
}

/** A delivery as GitHub sends it: JSON body, event name, delivery id and the SHA-256 signature. */
function delivery(
  payload: unknown,
  { deliveryId = randomUUID(), event = 'pull_request', secret = SECRET } = {},
): RequestInit {
  const body = JSON.stringify(payload);
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  };
}

function setupSolution() {
  const onError = vi.fn();
  const tasks = createBackgroundTasks(onError);
  const handler = createWebhookHandler({
    secret: SECRET,
    store: createInMemoryDeliveryStore(),
    process: createPullRequestOpenedProcessor(octokit()),
    runInBackground: (task) => tasks.run(task),
    onError,
  });
  return { tasks, onError, handler };
}

describe('flawed handler', () => {
  it('acts on an unsigned request', async () => {
    const comments = captureComments();
    const url = await serve(createFlawedHandler(octokit()));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request' },
      body: JSON.stringify(pullRequestOpened),
    });
    expect(response.status).toBe(200);
    expect(comments).toHaveLength(1);
  });

  it('comments twice when GitHub redelivers the same delivery', async () => {
    const comments = captureComments();
    const url = await serve(createFlawedHandler(octokit()));
    const deliveryId = randomUUID();
    await fetch(url, delivery(pullRequestOpened, { deliveryId }));
    await fetch(url, delivery(pullRequestOpened, { deliveryId }));
    expect(comments).toHaveLength(2);
  });
});

describe('solution handler', () => {
  it('accepts a signed delivery with 202 and comments the checklist afterwards', async () => {
    const { tasks, handler } = setupSolution();
    const comments = captureComments();
    const url = await serve(handler);

    const response = await fetch(url, delivery(pullRequestOpened));
    expect(response.status).toBe(202);

    await tasks.drain();
    expect(comments).toEqual([{ path: 'example-org/issue-service#42', body: reviewChecklist('marta-vidal') }]);
  });

  it('has a single effect when the same delivery arrives twice', async () => {
    const { tasks, handler } = setupSolution();
    const comments = captureComments();
    const url = await serve(handler);
    const deliveryId = randomUUID();

    const first = await fetch(url, delivery(pullRequestOpened, { deliveryId }));
    const second = await fetch(url, delivery(pullRequestOpened, { deliveryId }));
    await tasks.drain();

    expect([first.status, second.status]).toEqual([202, 200]);
    expect(await second.json()).toEqual({ message: 'duplicate' });
    expect(comments).toHaveLength(1);
  });

  it('returns 401 for a wrong signature and does nothing', async () => {
    const { tasks, handler } = setupSolution();
    const comments = captureComments();
    const url = await serve(handler);

    const response = await fetch(url, delivery(pullRequestOpened, { secret: 'replace-with-a-wrong-secret' }));
    await tasks.drain();
    expect(response.status).toBe(401);
    expect(comments).toEqual([]);
  });

  it('returns 401 when the body was changed after signing', async () => {
    const { handler } = setupSolution();
    const url = await serve(handler);
    const init = delivery(pullRequestOpened);
    const response = await fetch(url, { ...init, body: JSON.stringify({ ...pullRequestOpened, number: 1 }) });
    expect(response.status).toBe(401);
  });

  it('returns 400 without a delivery id', async () => {
    const { handler } = setupSolution();
    const url = await serve(handler);
    const init = delivery(pullRequestOpened);
    const headers = { ...(init.headers as Record<string, string>) };
    delete headers['x-github-delivery'];
    expect((await fetch(url, { ...init, headers })).status).toBe(400);
  });

  it('accepts other events and actions without commenting', async () => {
    const { tasks, handler } = setupSolution();
    const comments = captureComments();
    const url = await serve(handler);

    const closed = await fetch(url, delivery({ ...pullRequestOpened, action: 'closed' }));
    const ping = await fetch(url, delivery({ zen: 'Keep it logically awesome.' }, { event: 'ping' }));
    await tasks.drain();
    expect([closed.status, ping.status]).toEqual([202, 202]);
    expect(comments).toEqual([]);
  });

  it('lets a redelivery retry a delivery whose processing failed', async () => {
    const { tasks, onError, handler } = setupSolution();
    const comments = captureComments();
    mswServer.use(http.post(COMMENTS_URL, () => HttpResponse.json({}, { status: 502 }), { once: true }));
    const url = await serve(handler);
    const deliveryId = randomUUID();

    expect((await fetch(url, delivery(pullRequestOpened, { deliveryId }))).status).toBe(202);
    await tasks.drain();
    expect(onError).toHaveBeenCalledOnce();
    expect(comments).toEqual([]);

    expect((await fetch(url, delivery(pullRequestOpened, { deliveryId }))).status).toBe(202);
    await tasks.drain();
    expect(comments).toHaveLength(1);
  });
});
