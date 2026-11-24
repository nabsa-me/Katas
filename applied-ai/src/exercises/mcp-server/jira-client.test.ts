import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { ZodError } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeJira, FAKE_JIRA_CONFIG } from './fake-jira';
import { createJiraClient, JiraError, SEARCH_FIELDS, toAdfDocument } from './jira-client';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup() {
  const jira = createFakeJira();
  server.use(...jira.handlers);
  return { jira, client: createJiraClient(FAKE_JIRA_CONFIG) };
}

describe('searchIssues', () => {
  it('posts the JQL with Basic auth and only the fields the tool returns', async () => {
    const { jira, client } = setup();
    const page = await client.searchIssues('project = PLAT', 3);
    expect(page.issues.map((issue) => issue.key)).toEqual(['PLAT-101', 'PLAT-102', 'PLAT-103']);
    expect(page.isLast).toBe(false);
    expect(jira.requests).toEqual([
      {
        path: '/rest/api/3/search/jql',
        authorization: `Basic ${Buffer.from('ada@example.com:replace-with-an-api-token').toString('base64')}`,
        body: { jql: 'project = PLAT', maxResults: 3, fields: SEARCH_FIELDS },
      },
    ]);
  });

  it('turns an error response into a JiraError with Jira’s own messages', async () => {
    const { jira, client } = setup();
    jira.fail({ status: 400, body: { errorMessages: ["Field 'sprintt' does not exist."], errors: {} } });
    const error = await client.searchIssues('sprintt = 1', 10).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JiraError);
    expect(error).toMatchObject({ status: 400, jiraMessages: ["Field 'sprintt' does not exist."] });
  });

  it('keeps Retry-After from a 429', async () => {
    const { jira, client } = setup();
    jira.fail({ status: 429, headers: { 'Retry-After': '30' } });
    await expect(client.searchIssues('project = PLAT', 10)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('gives up after the timeout instead of holding the tool call open', async () => {
    server.use(
      http.post(`${FAKE_JIRA_CONFIG.baseUrl}/rest/api/3/search/jql`, async () => {
        await delay(500);
        return HttpResponse.json({ issues: [], isLast: true });
      }),
    );
    const client = createJiraClient({ ...FAKE_JIRA_CONFIG, timeoutMs: 50 });
    await expect(client.searchIssues('project = PLAT', 10)).rejects.toMatchObject({
      name: 'JiraError',
      status: undefined,
      message: 'Jira did not answer within 50 ms',
    });
  });

  it('rejects a response that does not have the expected shape', async () => {
    server.use(
      http.post(`${FAKE_JIRA_CONFIG.baseUrl}/rest/api/3/search/jql`, () => HttpResponse.json({ results: [] })),
    );
    await expect(createJiraClient(FAKE_JIRA_CONFIG).searchIssues('project = PLAT', 10)).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});

describe('addComment', () => {
  it('posts the text as an Atlassian Document Format body and returns the new comment id', async () => {
    const { jira, client } = setup();
    expect(await client.addComment('PLAT-104', 'Rolled back.\n\nRoot cause next.')).toEqual({
      id: '10000',
      created: '2026-11-24T10:00:00.000+0000',
    });
    expect(jira.requests[0]).toMatchObject({
      path: '/rest/api/3/issue/PLAT-104/comment',
      body: { body: toAdfDocument('Rolled back.\n\nRoot cause next.') },
    });
  });

  it('reports a missing issue as a 404 JiraError', async () => {
    const { client } = setup();
    await expect(client.addComment('PLAT-999', 'Hello')).rejects.toMatchObject({
      status: 404,
      jiraMessages: ['Issue does not exist or you do not have permission to see it.'],
    });
  });
});

describe('toAdfDocument', () => {
  it('makes one paragraph per block of text separated by blank lines', () => {
    expect(toAdfDocument('First line.\n\n  \nSecond paragraph.')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
      ],
    });
  });
});
