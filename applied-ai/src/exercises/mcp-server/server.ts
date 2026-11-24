import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ISSUE_KEY_PATTERN, toIssueView } from '../../lib/issues';
import type { Logger } from '../../lib/logger';
import { JiraError, type JiraClient } from './jira-client';

export const SERVER_INFO = { name: 'jira-katas', version: '0.1.0' };

const searchIssuesInput = {
  jql: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .describe(
      'JQL restricted to a project, for example: project = PLAT AND statusCategory != Done ORDER BY updated DESC',
    ),
  maxResults: z.number().int().min(1).max(50).default(10).describe('How many issues to return, 1 to 50'),
};

const addCommentInput = {
  issueKey: z.string().regex(ISSUE_KEY_PATTERN, 'expected a Jira issue key such as PLAT-101').describe('Issue key'),
  body: z.string().trim().min(1).max(5_000).describe('Comment text; a blank line starts a new paragraph'),
};

/**
 * Turns a failure into text the model can act on: what happened and what to do next. Jira's own messages are
 * passed on (an invalid JQL explains itself); credentials and internal details never are.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof JiraError)) return 'Unexpected error in the Jira MCP server. The details are in its logs.';
  const details = error.jiraMessages.length > 0 ? ` Jira says: ${error.jiraMessages.join(' ')}` : '';
  switch (true) {
    case error.status === undefined:
      return `${error.message}. Jira may be down or slow; try again later.`;
    case error.status === 400:
      return `Jira rejected the request as invalid (400).${details} Correct the input and try again.`;
    case error.status === 401:
      return 'Jira rejected the credentials (401). The server configuration (JIRA_EMAIL, JIRA_API_TOKEN) must be fixed by a person.';
    case error.status === 403:
      return `The Jira account is not allowed to do this (403).${details}`;
    case error.status === 404:
      return `Not found (404).${details || ' The issue does not exist or the account cannot see it.'}`;
    case error.status === 429:
      return `Jira is rate limiting requests (429). Wait ${error.retryAfterSeconds ?? 60} seconds before trying again.`;
    default:
      return `Jira is unavailable (${error.status}). Try again later.${details}`;
  }
}

export interface JiraMcpServerOptions {
  jira: JiraClient;
  logger: Logger;
}

/**
 * The Jira MCP server: one read tool and one write tool, each with a validated input schema and annotations that
 * tell clients which one changes data. Handlers never throw: every failure is a tool result with `isError: true`.
 * The transport is chosen by the caller (stdio in `stdio.ts`, in-memory in tests, Streamable HTTP when remote).
 */
export function createJiraMcpServer({ jira, logger }: JiraMcpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO);

  async function run(tool: string, work: () => Promise<string>): Promise<CallToolResult> {
    const startedAt = performance.now();
    const durationMs = () => Math.round(performance.now() - startedAt);
    try {
      const text = await work();
      logger.info({ tool, outcome: 'ok', durationMs: durationMs() }, 'tool call');
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      logger.warn({ tool, outcome: 'error', durationMs: durationMs(), err: error }, 'tool call failed');
      return { content: [{ type: 'text', text: describeFailure(error) }], isError: true };
    }
  }

  server.registerTool(
    'search_issues',
    {
      title: 'Search Jira issues',
      description:
        'Searches Jira issues with JQL and returns key, summary, status, assignee, priority, type and last update. ' +
        'The JQL must be restricted (for example by project). Read-only. moreResults: true means the JQL matched ' +
        'more issues than maxResults: narrow the query rather than asking for more.',
      inputSchema: searchIssuesInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ jql, maxResults }) =>
      run('search_issues', async () => {
        const page = await jira.searchIssues(jql, maxResults);
        return JSON.stringify({ issues: page.issues.map((issue) => toIssueView(issue)), moreResults: !page.isLast });
      }),
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Add a comment to a Jira issue',
      description:
        'Adds a comment to one Jira issue, visible to everyone who can see the issue. It cannot edit or delete ' +
        'comments. Calling it twice adds the comment twice.',
      inputSchema: addCommentInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ issueKey, body }) =>
      run('add_comment', async () => {
        const comment = await jira.addComment(issueKey, body);
        return `Comment ${comment.id} added to ${issueKey}.`;
      }),
  );

  return server;
}
