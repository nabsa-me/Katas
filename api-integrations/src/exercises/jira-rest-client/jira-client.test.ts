import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { ZodError } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import allIssues from '../../data/jira-issues.json';
import { basicAuth } from '../../lib/basic-auth';
import { createFakeJira, COMMENTS_ON_FIRST_ISSUE, SEARCH_PAGE_SIZE } from './fake-jira';
import { createJiraClient, JiraApiError, type JiraClientOptions } from './jira-client';
import { fetchIssuesWithComments } from './jira-client.problem';

const BASE_URL = 'https://katas-example.atlassian.net';
const AUTHORIZATION = basicAuth('ada@example.com', 'replace-with-an-api-token');
const JQL = 'project = PLAT AND statusCategory != Done ORDER BY updated DESC';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup(options: Partial<JiraClientOptions> = {}) {
  const jira = createFakeJira(options.baseUrl ?? BASE_URL);
  server.use(...jira.handlers);
  const sleeps: number[] = [];
  const client = createJiraClient({
    baseUrl: BASE_URL,
    authorization: AUTHORIZATION,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0, // no jitter: the delays are exact
    ...options,
  });
  return { jira, client, sleeps };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('flawed fetch', () => {
  it('reads only the first page and loses the rest without any error', async () => {
    const { jira } = setup();
    const issues = await fetchIssuesWithComments(BASE_URL, AUTHORIZATION, JQL);
    expect(issues).toHaveLength(SEARCH_PAGE_SIZE);
    expect(allIssues.length).toBeGreaterThan(SEARCH_PAGE_SIZE);
    expect(jira.searchBodies).toHaveLength(1);
  });

  it('crashes with a TypeError on a 429 instead of waiting and retrying', async () => {
    const { jira } = setup();
    jira.failSearchRequest(1, { status: 429, headers: { 'Retry-After': '2' } });
    await expect(fetchIssuesWithComments(BASE_URL, AUTHORIZATION, JQL)).rejects.toThrow(TypeError);
    expect(jira.searchBodies).toHaveLength(1);
  });

  it('sends every comment request at the same time', async () => {
    const { jira } = setup();
    await fetchIssuesWithComments(BASE_URL, AUTHORIZATION, JQL);
    expect(jira.maxCommentsInFlight).toBe(SEARCH_PAGE_SIZE);
  });
});

describe('typed client: search', () => {
  it('reads every issue across the pages, sending each nextPageToken back', async () => {
    const { jira, client } = setup();
    const issues = await collect(client.searchIssues(JQL));
    expect(issues.map((issue) => issue.key)).toEqual(allIssues.map((issue) => issue.key));
    expect(jira.searchBodies.map((body) => body.nextPageToken)).toEqual([
      undefined,
      'opaque-token-5',
      'opaque-token-10',
    ]);
    expect(jira.searchBodies[0]).toMatchObject({ jql: JQL, fields: ['summary', 'status', 'assignee', 'updated'] });
    expect(jira.authorizations.every((value) => value === AUTHORIZATION)).toBe(true);
  });

  it('yields typed issues, unassigned ones with assignee null', async () => {
    const { client } = setup();
    const [first] = await collect(client.searchIssuePages(JQL));
    expect(first?.find((issue) => issue.key === 'PLAT-103')?.fields.assignee).toBeNull();
  });

  it('honors Retry-After on a 429 and then reads the page again', async () => {
    const { jira, client, sleeps } = setup();
    jira.failSearchRequest(2, { status: 429, headers: { 'Retry-After': '2' } });
    const issues = await collect(client.searchIssues(JQL));
    expect(issues).toHaveLength(allIssues.length);
    expect(sleeps).toEqual([2000]);
    expect(jira.searchBodies.map((body) => body.nextPageToken)).toEqual([
      undefined,
      'opaque-token-5',
      'opaque-token-5',
      'opaque-token-10',
    ]);
  });

  it('backs off exponentially when there is no Retry-After, and gives up after five attempts', async () => {
    const { jira, client, sleeps } = setup({ random: () => 0.5 });
    for (let n = 1; n <= 5; n++) jira.failSearchRequest(n, { status: 503 });
    const error = await collect(client.searchIssues(JQL)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JiraApiError);
    expect((error as JiraApiError).status).toBe(503);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(jira.searchBodies).toHaveLength(5);
  });

  it('does not retry a bad request and reports Jira’s messages', async () => {
    const { jira, client, sleeps } = setup();
    jira.failSearchRequest(1, {
      status: 400,
      body: { errorMessages: ["The value 'NOPE' does not exist for the field 'project'."], errors: {} },
    });
    const error = await collect(client.searchIssues('project = NOPE')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JiraApiError);
    expect((error as JiraApiError).messages).toEqual(["The value 'NOPE' does not exist for the field 'project'."]);
    expect(sleeps).toEqual([]);
    expect(jira.searchBodies).toHaveLength(1);
  });

  it('stops requesting pages when the consumer stops early', async () => {
    const { jira, client } = setup();
    for await (const issue of client.searchIssues(JQL)) {
      expect(issue.key).toBe('PLAT-101');
      break;
    }
    expect(jira.searchBodies).toHaveLength(1);
  });

  it('rejects a response that does not match the schema instead of returning half-empty issues', async () => {
    const { client } = setup();
    server.use(http.post(`${BASE_URL}/rest/api/3/search/jql`, () => HttpResponse.json({ issues: [{ key: 'X-1' }] })));
    await expect(collect(client.searchIssues(JQL))).rejects.toBeInstanceOf(ZodError);
  });

  it('keeps the /ex/jira/{cloudId} prefix of the OAuth 2.0 (3LO) base URL', async () => {
    const oauthBaseUrl = 'https://api.atlassian.com/ex/jira/fictional-cloud-id';
    const { jira, client } = setup({ baseUrl: oauthBaseUrl, authorization: 'Bearer replace-with-an-access-token' });
    const issues = await collect(client.searchIssues(JQL));
    expect(issues).toHaveLength(allIssues.length);
    expect(jira.authorizations[0]).toBe('Bearer replace-with-an-access-token');
  });
});

describe('typed client: comments', () => {
  it('follows the offset pagination of the comments endpoint', async () => {
    const { client } = setup();
    const comments = await client.getComments('PLAT-101');
    expect(comments).toHaveLength(COMMENTS_ON_FIRST_ISSUE);
  });

  it('fetches comments for every issue with at most four requests in flight', async () => {
    const { jira, client } = setup();
    const keys = (await collect(client.searchIssues(JQL))).map((issue) => issue.key);
    const byIssue = await client.getCommentsByIssue(keys);
    expect([...byIssue.keys()]).toEqual(keys);
    expect(byIssue.get('PLAT-101')).toHaveLength(COMMENTS_ON_FIRST_ISSUE);
    expect(byIssue.get('PLAT-112')).toHaveLength(1);
    expect(jira.maxCommentsInFlight).toBe(4);
  });
});
