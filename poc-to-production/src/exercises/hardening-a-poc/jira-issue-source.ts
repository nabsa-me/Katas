import { z } from 'zod';
import { UpstreamError } from './errors';
import { postJson } from './http';
import type { IssueSource, OpenIssue } from './ports';
import { withRetry, type RetryOptions } from './retry';

const OPERATION = 'search issues';

/** Only what the digest reads. Unknown fields are ignored; a missing or malformed one is an error. */
const searchPageSchema = z.object({
  issues: z.array(
    z.object({
      key: z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/),
      fields: z.object({
        summary: z.string(),
        assignee: z.object({ displayName: z.string() }).nullish(),
      }),
    }),
  ),
  // Absent or null on the last page; `isLast` says it too.
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().optional(),
});

export interface JiraIssueSourceOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  /** Validated by the configuration, so it can go into the JQL as is. */
  projectKey: string;
  timeoutMs: number;
  retry: RetryOptions;
  /** Stops a pagination that never ends (a token that repeats) from looping forever. */
  maxPages?: number;
}

/**
 * Adapter for the `IssueSource` port: Jira Cloud's enhanced search (`POST /rest/api/3/search/jql`), following
 * `nextPageToken` until the last page. Each page is retried on its own, so a 429 on page 3 does not restart
 * the search. Basic auth with an API token; with OAuth 2.0 (3LO) only the base URL and the header change.
 */
export class JiraIssueSource implements IssueSource {
  readonly #options: JiraIssueSourceOptions;

  constructor(options: JiraIssueSourceOptions) {
    this.#options = options;
  }

  async listOpenIssues(): Promise<OpenIssue[]> {
    const { baseUrl, email, apiToken, projectKey, timeoutMs, retry, maxPages = 50 } = this.#options;
    const authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
    const issues: OpenIssue[] = [];
    let nextPageToken: string | undefined;

    for (let page = 1; page <= maxPages; page++) {
      const body = {
        jql: `project = ${projectKey} AND statusCategory != Done ORDER BY key ASC`,
        fields: ['summary', 'assignee'],
        maxResults: 100,
        nextPageToken,
      };
      const result = await withRetry(
        () =>
          postJson(
            {
              service: 'jira',
              operation: OPERATION,
              url: `${baseUrl}/rest/api/3/search/jql`,
              headers: { Authorization: authorization },
              body,
              timeoutMs,
              idempotent: true,
            },
            searchPageSchema,
          ),
        retry,
      );
      for (const issue of result.issues) {
        issues.push({
          key: issue.key,
          summary: issue.fields.summary,
          assignee: issue.fields.assignee?.displayName ?? null,
          url: `${baseUrl}/browse/${issue.key}`,
        });
      }
      if (result.isLast === true || !result.nextPageToken) return issues;
      nextPageToken = result.nextPageToken;
    }
    throw new UpstreamError({ service: 'jira', operation: OPERATION, code: 'too_many_pages', retryable: false });
  }
}
