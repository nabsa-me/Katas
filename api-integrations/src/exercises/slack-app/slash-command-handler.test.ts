import { createHmac } from 'node:crypto';
import type { RequestListener } from 'node:http';
import { passthrough } from 'msw';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBackgroundTasks } from '../../lib/background-tasks';
import { startLocalServer, type LocalServer } from '../../lib/local-server';
import type { IssueReport } from './report-message';
import { createReportWorker } from './report-worker';
import { createSlashCommandHandler, type SlashCommandJob } from './slash-command-handler';
import { createSlashCommandHandler as createFlawedHandler } from './slash-command-handler.problem';

const SIGNING_SECRET = 'replace-with-the-app-signing-secret';
const RESPONSE_URL = 'https://hooks.slack.com/commands/T0FICTION/1234567890/replace-with-a-response-path';
const SLACK_TIMEOUT_MS = 3000;
const REPORT: IssueReport = {
  projectKey: 'PLAT',
  issues: [{ key: 'PLAT-101', summary: 'Rotate the database credentials', status: 'To Do' }],
};

const mswServer = setupServer();
beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

let local: LocalServer | undefined;
afterEach(async () => {
  await local?.close();
  local = undefined;
});

/** A promise the test resolves by hand: the report stays "being built" until the test says otherwise. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Serves `handler` on a local port and lets those requests through msw, which otherwise rejects unknown hosts. */
async function serve(handler: RequestListener): Promise<string> {
  local = await startLocalServer(handler);
  mswServer.use(http.all(`${local.url}/*`, () => passthrough()));
  return `${local.url}/slack/commands`;
}

/** Records what the worker posts to `response_url`. */
function captureResponseUrl() {
  const messages: unknown[] = [];
  mswServer.use(
    http.post('https://hooks.slack.com/commands/*', async ({ request }) => {
      messages.push(await request.json());
      return new HttpResponse('ok');
    }),
  );
  return messages;
}

function commandBody(fields: Record<string, string> = {}): string {
  return new URLSearchParams({
    command: '/open-issues',
    text: 'plat',
    user_id: 'U0FICTION1',
    channel_id: 'C0FICTION1',
    team_id: 'T0FICTION',
    response_url: RESPONSE_URL,
    ...fields,
  }).toString();
}

/** Signs like Slack does: HMAC-SHA256 of `v0:{timestamp}:{body}` with the signing secret. */
function slackHeaders(body: string, { secret = SIGNING_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const signature = createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return {
    'content-type': 'application/x-www-form-urlencoded',
    'x-slack-request-timestamp': String(timestamp),
    'x-slack-signature': `v0=${signature}`,
  };
}

function setupSolution() {
  const report = deferred<IssueReport>();
  const buildReport = vi.fn(() => report.promise);
  const onError = vi.fn();
  const tasks = createBackgroundTasks(onError);
  const worker = createReportWorker({ buildReport });
  const enqueue = vi.fn((job: SlashCommandJob) => tasks.run(() => worker(job)));
  const handler = createSlashCommandHandler({ signingSecret: SIGNING_SECRET, enqueue });
  return { report, buildReport, tasks, enqueue, onError, handler };
}

describe('flawed handler', () => {
  it('runs the command for an unsigned request', async () => {
    const url = await serve(createFlawedHandler(async () => REPORT));
    const response = await fetch(url, { method: 'POST', body: commandBody() });
    expect(response.status).toBe(200);
  });

  it('does not answer until the report is built, so a slow report means a Slack timeout', async () => {
    const report = deferred<IssueReport>();
    const url = await serve(createFlawedHandler(() => report.promise));
    const request = fetch(url, { method: 'POST', body: commandBody() });

    const first = await Promise.race([request.then(() => 'answered'), sleep(200).then(() => 'still waiting')]);
    expect(first).toBe('still waiting');

    report.resolve(REPORT);
    expect((await request).status).toBe(200);
  });
});

describe('solution handler', () => {
  it('acknowledges well within 3 seconds while the report is still being built', async () => {
    const { buildReport, tasks, handler, report } = setupSolution();
    const posted = captureResponseUrl();
    const url = await serve(handler);
    const body = commandBody();

    const start = performance.now();
    const response = await fetch(url, { method: 'POST', headers: slackHeaders(body), body });
    const elapsed = performance.now() - start;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      response_type: 'ephemeral',
      text: 'Building the open issues report for PLAT…',
    });
    expect(elapsed).toBeLessThan(SLACK_TIMEOUT_MS);
    await vi.waitFor(() => expect(buildReport).toHaveBeenCalledWith('PLAT'));
    expect(posted).toEqual([]); // the report has not been sent: it is still being built

    report.resolve(REPORT);
    await tasks.drain();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      response_type: 'ephemeral',
      text: 'Open issues in PLAT: 1',
      blocks: [{ type: 'header' }, { type: 'section' }, { type: 'context' }],
    });
  });

  it('rejects a request signed with another secret, and runs nothing', async () => {
    const { enqueue, handler } = setupSolution();
    const url = await serve(handler);
    const body = commandBody();
    const response = await fetch(url, {
      method: 'POST',
      headers: slackHeaders(body, { secret: 'replace-with-a-wrong-secret' }),
      body,
    });
    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects a correctly signed request replayed six minutes later', async () => {
    const { enqueue, handler } = setupSolution();
    const url = await serve(handler);
    const body = commandBody();
    const sixMinutesAgo = Math.floor(Date.now() / 1000) - 6 * 60;
    const response = await fetch(url, {
      method: 'POST',
      headers: slackHeaders(body, { timestamp: sixMinutesAgo }),
      body,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ text: 'Invalid request: stale-timestamp' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects a body changed after it was signed', async () => {
    const { enqueue, handler } = setupSolution();
    const url = await serve(handler);
    const response = await fetch(url, {
      method: 'POST',
      headers: slackHeaders(commandBody()),
      body: commandBody({ text: 'SECRET' }),
    });
    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('refuses a response_url outside hooks.slack.com, even when signed', async () => {
    const { enqueue, handler } = setupSolution();
    const url = await serve(handler);
    const body = commandBody({ response_url: 'https://internal.example.com/admin' });
    const response = await fetch(url, { method: 'POST', headers: slackHeaders(body), body });
    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('answers a usage hint without queuing anything when the project key is missing', async () => {
    const { enqueue, handler } = setupSolution();
    const url = await serve(handler);
    const body = commandBody({ text: '  ' });
    const response = await fetch(url, { method: 'POST', headers: slackHeaders(body), body });
    expect(await response.json()).toEqual({
      response_type: 'ephemeral',
      text: 'Usage: /open-issues PROJECT_KEY, for example /open-issues PLAT',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('tells the user when the report fails, and reports the error', async () => {
    const { report, tasks, onError, handler } = setupSolution();
    const posted = captureResponseUrl();
    const url = await serve(handler);
    const body = commandBody();
    await fetch(url, { method: 'POST', headers: slackHeaders(body), body });

    report.reject(new Error('Jira is down'));
    await tasks.drain();
    expect(posted).toEqual([{ response_type: 'ephemeral', text: 'Could not build the report for PLAT.' }]);
    expect(onError).toHaveBeenCalledWith(new Error('Jira is down'));
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
