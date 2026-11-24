import { delay } from 'msw';
import { HttpResponse, http } from 'msw/http';
import allIssues from '../../data/jira-issues.json';

/** The fake server answers at most this many issues per page, whatever `maxResults` asks for, as Jira may. */
export const SEARCH_PAGE_SIZE = 5;
/** Comments per page, so the offset pagination of the comments endpoint is exercised too. */
export const COMMENT_PAGE_SIZE = 2;
/** PLAT-101 has three comments (two pages); every other issue has one. */
export const COMMENTS_ON_FIRST_ISSUE = 3;

export interface SearchRequestBody {
  jql: string;
  fields?: string[];
  maxResults?: number;
  nextPageToken?: string;
}

export interface FailureResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * A fake Jira Cloud for msw: the search endpoint with token pagination, the comments endpoint with offset
 * pagination, scripted failures by request number, and a record of what the client sent.
 */
export function createFakeJira(baseUrl: string) {
  const searchBodies: SearchRequestBody[] = [];
  const authorizations: (string | null)[] = [];
  const failures = new Map<number, FailureResponse>();
  let commentsInFlight = 0;
  let maxCommentsInFlight = 0;

  const searchHandler = http.post(`${baseUrl}/rest/api/3/search/jql`, async ({ request }) => {
    const body = (await request.json()) as SearchRequestBody;
    searchBodies.push(body);
    authorizations.push(request.headers.get('authorization'));

    const failure = failures.get(searchBodies.length);
    if (failure) {
      return HttpResponse.json(failure.body ?? { errorMessages: ['Scripted failure'] }, {
        status: failure.status,
        headers: failure.headers,
      });
    }

    // Tokens are opaque to the client; this fake encodes the offset in them.
    const start = body.nextPageToken ? Number(body.nextPageToken.replace('opaque-token-', '')) : 0;
    const issues = allIssues.slice(start, start + SEARCH_PAGE_SIZE);
    const isLast = start + SEARCH_PAGE_SIZE >= allIssues.length;
    return HttpResponse.json(
      isLast ? { issues, isLast } : { issues, isLast, nextPageToken: `opaque-token-${start + SEARCH_PAGE_SIZE}` },
    );
  });

  const commentsHandler = http.get(`${baseUrl}/rest/api/3/issue/:issueKey/comment`, async ({ params, request }) => {
    commentsInFlight++;
    maxCommentsInFlight = Math.max(maxCommentsInFlight, commentsInFlight);
    await delay(10);
    commentsInFlight--;

    const issueKey = String(params.issueKey);
    const total = issueKey === 'PLAT-101' ? COMMENTS_ON_FIRST_ISSUE : 1;
    const url = new URL(request.url);
    const startAt = Number(url.searchParams.get('startAt') ?? 0);
    const maxResults = Math.min(Number(url.searchParams.get('maxResults') ?? 50), COMMENT_PAGE_SIZE);
    const comments = Array.from({ length: total }, (_, i) => ({
      id: `${issueKey}-comment-${i + 1}`,
      author: { displayName: 'Marta Vidal' },
      created: '2026-11-20T10:00:00.000+0100',
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks good' }] }],
      },
    })).slice(startAt, startAt + maxResults);
    return HttpResponse.json({ comments, startAt, maxResults, total });
  });

  return {
    handlers: [searchHandler, commentsHandler],
    searchBodies,
    authorizations,
    /** Makes the n-th search request (1-based) fail with the given response. */
    failSearchRequest(requestNumber: number, response: FailureResponse) {
      failures.set(requestNumber, response);
    },
    get maxCommentsInFlight() {
      return maxCommentsInFlight;
    },
  };
}
