import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeApis, FAKE_CREDENTIALS, FAKE_JIRA_BASE_URL, sampleIssues, SLACK_API_URL } from './fake-apis';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const jiraAuthorization = `Basic ${Buffer.from(`${FAKE_CREDENTIALS.jiraEmail}:${FAKE_CREDENTIALS.jiraApiToken}`).toString('base64')}`;

function searchJira(body: Record<string, unknown>, authorization = jiraAuthorization) {
  return fetch(`${FAKE_JIRA_BASE_URL}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postToSlack(body: Record<string, unknown>, token = FAKE_CREDENTIALS.slackBotToken) {
  return fetch(`${SLACK_API_URL}/chat.postMessage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('fake Jira search', () => {
  it('pages through the sample issues with nextPageToken until isLast', async () => {
    server.use(...createFakeApis().handlers);
    const keys: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const response = await searchJira({ jql: 'project = PLAT', nextPageToken: token });
      const page = (await response.json()) as { issues: Array<{ key: string }>; nextPageToken?: string };
      keys.push(...page.issues.map((issue) => issue.key));
      token = page.nextPageToken;
      pages++;
    } while (token);
    expect(pages).toBe(3);
    expect(keys).toEqual(sampleIssues.map((issue) => issue.key));
  });

  it('rejects other credentials with 401', async () => {
    server.use(...createFakeApis().handlers);
    const otherCredentials = `Basic ${Buffer.from('someone@example.com:another-token').toString('base64')}`;
    expect((await searchJira({}, otherCredentials)).status).toBe(401);
  });

  it('answers the configured failures first, with Retry-After on a 429', async () => {
    const fakes = createFakeApis({ jiraFailures: [429, 503], retryAfterSeconds: 2 });
    server.use(...fakes.handlers);
    const limited = await searchJira({});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('2');
    expect((await searchJira({})).status).toBe(503);
    expect((await searchJira({})).status).toBe(200);
    expect(fakes.jiraRequests).toHaveLength(3);
  });
});

describe('fake Slack chat.postMessage', () => {
  it('records accepted messages and answers ok with a ts', async () => {
    const fakes = createFakeApis();
    server.use(...fakes.handlers);
    const body = await (await postToSlack({ channel: 'C0123456789', text: 'hello' })).json();
    expect(body).toMatchObject({ ok: true, channel: 'C0123456789' });
    expect(fakes.slackPosts).toEqual([{ channel: 'C0123456789', text: 'hello' }]);
  });

  it('answers errors over HTTP 200 with ok: false, as Slack does', async () => {
    const fakes = createFakeApis({ slackFailures: ['channel_not_found'] });
    server.use(...fakes.handlers);
    const response = await postToSlack({ channel: 'C0123456789', text: 'hello' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, error: 'channel_not_found' });
    expect(await (await postToSlack({ channel: 'C1', text: 'x' }, 'wrong')).json()).toEqual({
      ok: false,
      error: 'invalid_auth',
    });
    expect(fakes.slackPosts).toEqual([]);
  });

  it('rate limits with HTTP 429 and Retry-After', async () => {
    server.use(...createFakeApis({ slackFailures: [429] }).handlers);
    const response = await postToSlack({ channel: 'C0123456789', text: 'hello' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
  });
});
