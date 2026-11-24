import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createFakeApis,
  FAKE_CREDENTIALS,
  FAKE_JIRA_BASE_URL,
  sampleIssues,
  type FakeApiOptions,
} from '../../lib/fake-apis';
import { InvalidResponseError, UpstreamError } from './errors';
import { JiraIssueSource } from './jira-issue-source';
import { DEFAULT_RETRY_POLICY } from './retry';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SEARCH_URL = `${FAKE_JIRA_BASE_URL}/rest/api/3/search/jql`;

function setup(fakeOptions: FakeApiOptions = {}, timeoutMs = 1_000) {
  const fakes = createFakeApis(fakeOptions);
  server.use(...fakes.handlers);
  const delays: number[] = [];
  const source = new JiraIssueSource({
    baseUrl: FAKE_JIRA_BASE_URL,
    email: FAKE_CREDENTIALS.jiraEmail,
    apiToken: FAKE_CREDENTIALS.jiraApiToken,
    projectKey: 'PLAT',
    timeoutMs,
    retry: { policy: DEFAULT_RETRY_POLICY, sleep: async (ms) => void delays.push(ms), random: () => 0.5 },
  });
  return { fakes, delays, source };
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => expect.fail('expected the search to fail'),
    (error: unknown) => error,
  );
}

describe('JiraIssueSource against a fake Jira', () => {
  it('follows nextPageToken until the last page and maps every issue', async () => {
    const { fakes, source } = setup();
    const issues = await source.listOpenIssues();
    expect(fakes.jiraRequests).toHaveLength(3);
    expect(issues.map((issue) => issue.key)).toEqual(sampleIssues.map((issue) => issue.key));
    expect(issues.at(-1)).toEqual({
      key: 'PLAT-112',
      summary: 'Triage the flaky end-to-end test',
      assignee: null,
      url: 'https://example.atlassian.net/browse/PLAT-112',
    });
  });

  it('sends Basic auth and a bounded JQL query with only the fields it needs', async () => {
    const { fakes, source } = setup();
    await source.listOpenIssues();
    const [first, second] = fakes.jiraRequests;
    expect(first?.authorization).toMatch(/^Basic /);
    expect(first?.body).toEqual({
      jql: 'project = PLAT AND statusCategory != Done ORDER BY key ASC',
      fields: ['summary', 'assignee'],
      maxResults: 100,
    });
    expect(second?.body.nextPageToken).toBe('page-5');
  });

  it('waits what Retry-After says on a 429 and carries on from the same page', async () => {
    const { fakes, delays, source } = setup({ jiraFailures: [429, 429], retryAfterSeconds: 2 });
    await expect(source.listOpenIssues()).resolves.toHaveLength(sampleIssues.length);
    expect(delays).toEqual([2_000, 2_000]);
    expect(fakes.jiraRequests).toHaveLength(5);
  });

  it('retries a 503: searching twice is harmless', async () => {
    const { delays, source } = setup({ jiraFailures: [503] });
    await expect(source.listOpenIssues()).resolves.toHaveLength(sampleIssues.length);
    expect(delays).toEqual([500]);
  });

  it('fails at once on 401, without retrying: the token will not get better', async () => {
    const { fakes, source } = setup({ credentials: { ...FAKE_CREDENTIALS, jiraApiToken: 'another-token' } });
    const error = await failure(source.listOpenIssues());
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ service: 'jira', status: 401, code: 'http_401', retryable: false });
    expect(fakes.jiraRequests).toHaveLength(1);
  });

  it('gives up after the policy attempts when Jira keeps failing', async () => {
    const { fakes, source } = setup({ jiraFailures: [503, 503, 503, 503, 503] });
    expect(await failure(source.listOpenIssues())).toMatchObject({ status: 503 });
    expect(fakes.jiraRequests).toHaveLength(DEFAULT_RETRY_POLICY.maxAttempts);
  });

  it('rejects a response with an unexpected shape, naming the field', async () => {
    const { source } = setup();
    server.use(http.post(SEARCH_URL, () => HttpResponse.json({ issues: [{ key: 'PLAT-1', fields: {} }] })));
    const error = await failure(source.listOpenIssues());
    expect(error).toBeInstanceOf(InvalidResponseError);
    expect((error as InvalidResponseError).issues).toEqual([expect.stringMatching(/^issues\.0\.fields\.summary: /)]);
  });

  it('rejects a body that is not JSON, such as a proxy error page', async () => {
    const { source } = setup();
    server.use(http.post(SEARCH_URL, () => HttpResponse.html('<h1>Bad gateway</h1>')));
    expect(await failure(source.listOpenIssues())).toBeInstanceOf(InvalidResponseError);
  });

  it('times out a search that does not answer, and retries it', async () => {
    const { delays, source } = setup({}, 50);
    let calls = 0;
    server.use(
      http.post(SEARCH_URL, async () => {
        calls++;
        await delay(calls === 1 ? 1_000 : 0);
        return HttpResponse.json({ issues: [], isLast: true });
      }),
    );
    await expect(source.listOpenIssues()).resolves.toEqual([]);
    expect(calls).toBe(2);
    expect(delays).toHaveLength(1);
  });

  it('stops a pagination that never ends', async () => {
    const { source } = setup();
    server.use(http.post(SEARCH_URL, () => HttpResponse.json({ issues: [], nextPageToken: 'again', isLast: false })));
    expect(await failure(source.listOpenIssues())).toMatchObject({ code: 'too_many_pages' });
  });
});
