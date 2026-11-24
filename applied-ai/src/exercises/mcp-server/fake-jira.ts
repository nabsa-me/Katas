import { http, HttpResponse } from 'msw/http';
import { sampleIssues } from '../../lib/issues';
import type { JiraConfig } from './config';

/** Fictional site and credentials. The token is a placeholder, not a real token format. */
export const FAKE_JIRA_CONFIG: JiraConfig = {
  baseUrl: 'https://katas-example.atlassian.net',
  email: 'ada@example.com',
  apiToken: 'replace-with-an-api-token',
  timeoutMs: 1_000,
};

export interface RecordedJiraRequest {
  path: string;
  authorization: string | null;
  body: unknown;
}

interface ScriptedFailure {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * msw handlers that answer like Jira Cloud for the two endpoints the server uses, record every request, and fail
 * on demand: `fail({ status: 500 })` makes the next request fail. Comments on unknown issues get Jira's 404.
 */
export function createFakeJira(baseUrl = FAKE_JIRA_CONFIG.baseUrl) {
  const requests: RecordedJiraRequest[] = [];
  const failures: ScriptedFailure[] = [];
  let nextCommentId = 10_000;

  async function record(request: Request): Promise<{ body: Record<string, unknown>; failure?: Response }> {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const path = new URL(request.url).pathname;
    requests.push({ path, authorization: request.headers.get('authorization'), body });
    const failure = failures.shift();
    if (!failure) return { body };
    const init = { status: failure.status, headers: failure.headers };
    return {
      body,
      failure: failure.body === undefined ? new HttpResponse(null, init) : HttpResponse.json(failure.body, init),
    };
  }

  const handlers = [
    http.post(`${baseUrl}/rest/api/3/search/jql`, async ({ request }) => {
      const { body, failure } = await record(request);
      if (failure) return failure;
      const maxResults = typeof body.maxResults === 'number' ? body.maxResults : 50;
      const isLast = maxResults >= sampleIssues.length;
      return HttpResponse.json({
        issues: sampleIssues.slice(0, maxResults),
        isLast,
        ...(isLast ? {} : { nextPageToken: 'fake-next-page-token' }),
      });
    }),
    http.post(`${baseUrl}/rest/api/3/issue/:issueKey/comment`, async ({ request, params }) => {
      const { failure } = await record(request);
      if (failure) return failure;
      if (!sampleIssues.some((issue) => issue.key === params.issueKey)) {
        return HttpResponse.json(
          { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} },
          { status: 404 },
        );
      }
      return HttpResponse.json(
        { id: String(nextCommentId++), created: '2026-11-24T10:00:00.000+0000' },
        { status: 201 },
      );
    }),
  ];

  return {
    handlers,
    requests,
    fail(failure: ScriptedFailure) {
      failures.push(failure);
    },
  };
}
