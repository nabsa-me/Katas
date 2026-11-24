import { mapWithConcurrency } from '../../lib/map-with-concurrency';
import { sleep as realSleep, type Random, type Sleep } from '../../lib/time';
import {
  commentPageSchema,
  errorCollectionSchema,
  ISSUE_FIELDS,
  searchPageSchema,
  type JiraComment,
  type JiraIssue,
} from './jira-schemas';
import { DEFAULT_RETRY_POLICY, retryDelayMs, type RetryPolicy } from './retry-policy';

/** A response Jira will not answer differently if asked again: the caller has to change something. */
export class JiraApiError extends Error {
  readonly status: number;
  readonly messages: string[];

  constructor(status: number, messages: string[], attempts: number) {
    super(`Jira answered ${status} after ${attempts} attempt(s): ${messages.join('; ') || 'no details'}`);
    this.name = 'JiraApiError';
    this.status = status;
    this.messages = messages;
  }
}

export interface JiraClientOptions {
  /** `https://your-site.atlassian.net` with an API token, `https://api.atlassian.com/ex/jira/{cloudId}` with OAuth. */
  baseUrl: string;
  /** Full header value: `basicAuth(email, apiToken)`, or `Bearer <access token>` with OAuth 2.0 (3LO). */
  authorization: string;
  sleep?: Sleep;
  random?: Random;
  retryPolicy?: RetryPolicy;
  /** Most requests in flight when fetching something for many issues. */
  concurrency?: number;
}

export interface SearchOptions {
  /** `maxResults` per page. Jira may return fewer, so pagination never relies on it. */
  pageSize?: number;
}

export type JiraClient = ReturnType<typeof createJiraClient>;

export function createJiraClient({
  baseUrl,
  authorization,
  sleep = realSleep,
  random = Math.random,
  retryPolicy = DEFAULT_RETRY_POLICY,
  concurrency = 4,
}: JiraClientOptions) {
  // Concatenate instead of `new URL(path, baseUrl)`: a path starting with "/" would drop the `/ex/jira/{cloudId}`
  // prefix of the OAuth base URL.
  const root = baseUrl.replace(/\/+$/, '');

  /** Sends a request, retries what the policy says is retryable, and returns the JSON body (still `unknown`). */
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${root}${path}`, {
        ...init,
        headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
      });
      if (response.ok) return response.json();

      const delay = retryDelayMs({
        status: response.status,
        attempt,
        retryAfter: response.headers.get('retry-after'),
        random,
        policy: retryPolicy,
      });
      if (delay === null) throw new JiraApiError(response.status, await errorMessages(response), attempt);
      await response.body?.cancel(); // release the connection before waiting
      await sleep(delay);
    }
  }

  /**
   * Yields the search results one page at a time. Each page's `nextPageToken` goes into the next request, until
   * `isLast` is true or no token comes back. `POST` is used because the JQL and the field list can be long; it is
   * still a read, which is why retrying it is safe.
   */
  async function* searchIssuePages(jql: string, { pageSize = 50 }: SearchOptions = {}): AsyncGenerator<JiraIssue[]> {
    let nextPageToken: string | undefined;
    do {
      const body = JSON.stringify({ jql, fields: ISSUE_FIELDS, maxResults: pageSize, nextPageToken });
      const page = searchPageSchema.parse(await request('/rest/api/3/search/jql', { method: 'POST', body }));
      yield page.issues;
      nextPageToken = page.isLast ? undefined : (page.nextPageToken ?? undefined);
    } while (nextPageToken);
  }

  /** Issues one by one, across every page. Lazy: a consumer that stops early stops the requests too. */
  async function* searchIssues(jql: string, options?: SearchOptions): AsyncGenerator<JiraIssue> {
    for await (const page of searchIssuePages(jql, options)) yield* page;
  }

  /** Every comment of one issue, following the offset pagination of this endpoint. */
  async function getComments(issueKey: string): Promise<JiraComment[]> {
    const comments: JiraComment[] = [];
    for (;;) {
      const query = new URLSearchParams({ startAt: String(comments.length), maxResults: '100' });
      const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?${query}`;
      const page = commentPageSchema.parse(await request(path));
      comments.push(...page.comments);
      if (page.comments.length === 0 || comments.length >= page.total) return comments;
    }
  }

  /** Comments for many issues, never more than `concurrency` requests at the same time. */
  async function getCommentsByIssue(issueKeys: readonly string[]): Promise<Map<string, JiraComment[]>> {
    const results = await mapWithConcurrency(issueKeys, concurrency, (key) => getComments(key));
    return new Map(issueKeys.map((key, index) => [key, results[index] ?? []]));
  }

  return { searchIssuePages, searchIssues, getComments, getCommentsByIssue };
}

/** The messages of a Jira error body, or none when the body is not Jira's error format (an HTML error page). */
async function errorMessages(response: Response): Promise<string[]> {
  const text = await response.text();
  try {
    const parsed = errorCollectionSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return [];
    return [...(parsed.data.errorMessages ?? []), ...Object.values(parsed.data.errors ?? {})];
  } catch {
    return [];
  }
}
