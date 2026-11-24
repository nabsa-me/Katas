import { z } from 'zod';
import { jiraIssueSchema, type JiraIssue } from '../../lib/issues';
import type { JiraConfig } from './config';

/** The fields a search asks for: only what the tool returns, so pages stay small. */
export const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'updated'];

const searchPageSchema = z.object({
  issues: z.array(jiraIssueSchema),
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().optional(),
});

const createdCommentSchema = z.object({ id: z.string(), created: z.string() });

const errorBodySchema = z.object({
  errorMessages: z.array(z.string()).default([]),
  errors: z.record(z.string(), z.string()).default({}),
});

/** A request Jira refused or never answered. `status` is undefined when no response arrived (timeout, network). */
export class JiraError extends Error {
  override name = 'JiraError';
  readonly status: number | undefined;
  /** Jira's own explanation (`errorMessages` and per-field `errors`), safe to show: it never contains credentials. */
  readonly jiraMessages: string[];
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    details: { status?: number; jiraMessages?: string[]; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.status = details.status;
    this.jiraMessages = details.jiraMessages ?? [];
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

export interface SearchPage {
  issues: JiraIssue[];
  /** False when Jira has more results than were returned. */
  isLast: boolean;
}

/** The two Jira operations the MCP server exposes. An interface, so tests and other adapters can replace it. */
export interface JiraClient {
  searchIssues(jql: string, maxResults: number): Promise<SearchPage>;
  addComment(issueKey: string, text: string): Promise<{ id: string; created: string }>;
}

/** A comment in Atlassian Document Format: one paragraph per block of text separated by a blank line. */
export function toAdfDocument(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim());
  return {
    type: 'doc',
    version: 1,
    content: paragraphs
      .filter(Boolean)
      .map((paragraph) => ({ type: 'paragraph', content: [{ type: 'text', text: paragraph }] })),
  };
}

async function jiraMessagesOf(response: Response): Promise<string[]> {
  const parsed = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) return [];
  const fieldErrors = Object.entries(parsed.data.errors).map(([field, message]) => `${field}: ${message}`);
  return [...parsed.data.errorMessages, ...fieldErrors];
}

/** Jira Cloud REST v3 over Basic auth (`email:apiToken`), with a timeout per request and validated responses. */
export function createJiraClient(config: JiraConfig, fetchImpl: typeof fetch = fetch): JiraClient {
  const authorization = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;

  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const message = timedOut ? `Jira did not answer within ${config.timeoutMs} ms` : 'Could not reach Jira';
      throw new JiraError(message, { cause: error });
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new JiraError(`Jira answered ${response.status} to POST ${path}`, {
        status: response.status,
        jiraMessages: await jiraMessagesOf(response),
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    return response.json();
  }

  return {
    async searchIssues(jql, maxResults) {
      const page = searchPageSchema.parse(
        await post('/rest/api/3/search/jql', { jql, maxResults, fields: SEARCH_FIELDS }),
      );
      return { issues: page.issues, isLast: page.isLast ?? !page.nextPageToken };
    },
    async addComment(issueKey, text) {
      const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;
      return createdCommentSchema.parse(await post(path, { body: toAdfDocument(text) }));
    },
  };
}
