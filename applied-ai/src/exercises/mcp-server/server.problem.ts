/* eslint-disable @typescript-eslint/no-explicit-any -- the flawed version keeps the untyped code it is about */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { JiraConfig } from './config';

/** Flawed: a Jira MCP server as it is often first written. It works in a demo with well-behaved input. */
export function createProblemServer(jira: Pick<JiraConfig, 'baseUrl' | 'email' | 'apiToken'>): McpServer {
  const server = new McpServer({ name: 'jira-problem', version: '0.0.1' });
  const headers = {
    authorization: `Basic ${Buffer.from(`${jira.email}:${jira.apiToken}`).toString('base64')}`,
    'content-type': 'application/json',
  };

  // BUG: one tool for reads and writes, with no annotations. A client cannot tell a search from a write, so it
  // either asks for approval on every search or approves comments without asking.
  // BUG: `z.any()` publishes an empty input schema: the model has to guess the parameters, and nothing is checked.
  server.registerTool('jira', { description: 'Talks to Jira', inputSchema: z.any() }, async (args: any) => {
    if (args.action === 'search') {
      const res = await fetch(`${jira.baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jql: args.jql, fields: ['summary'] }),
      });
      const data: any = await res.json();
      // BUG: no status check. An error body has no `issues`, the handler throws a TypeError, and its message is
      // all the model ever sees: "Cannot read properties of undefined", not "the credentials are wrong".
      return { content: [{ type: 'text', text: JSON.stringify(data.issues.map((i: any) => i.fields.summary)) }] };
    }
    // BUG: anything that is not a search is a write. A typo in `action` or a missing `body` posts "undefined".
    const res = await fetch(`${jira.baseUrl}/rest/api/3/issue/${args.issueKey}/comment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `${args.body}` }] }],
        },
      }),
    });
    // BUG: the status is ignored, so a 404 or a 403 is reported to the model as a comment that was added.
    return { content: [{ type: 'text', text: `Comment added: ${await res.text()}` }] };
  });

  return server;
}
