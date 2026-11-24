import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, memoryDestination } from '../../lib/logger';
import { createFakeJira, FAKE_JIRA_CONFIG } from './fake-jira';
import { createJiraClient } from './jira-client';
import { createJiraMcpServer } from './server';
import { createProblemServer } from './server.problem';

const msw = setupServer();
beforeAll(() => msw.listen({ onUnhandledFrame: 'error' }));
afterAll(() => msw.close());

const clients: Client[] = [];
afterEach(async () => {
  msw.resetHandlers();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/** Connects a real MCP client to the server through a linked pair of in-memory transports. */
async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'kata-test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}

async function setup() {
  const jira = createFakeJira();
  msw.use(...jira.handlers);
  const { records, destination } = memoryDestination();
  const logger = createLogger({ name: 'jira-mcp', destination });
  const client = await connect(createJiraMcpServer({ jira: createJiraClient(FAKE_JIRA_CONFIG), logger }));
  return { jira, client, records };
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;
const textOf = (result: ToolResult) =>
  (result.content as Array<{ type: string; text?: string }>).map((block) => block.text ?? '').join('');

describe('Jira MCP server: tools/list', () => {
  it('lists a read tool and a write tool with input schemas and annotations', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['search_issues', 'add_comment']);
    const [search, comment] = tools;
    expect(search?.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(comment?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(search?.inputSchema).toMatchObject({
      type: 'object',
      properties: { jql: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 50 } },
      required: expect.arrayContaining(['jql']),
    });
    expect(comment?.inputSchema).toMatchObject({
      properties: { issueKey: { pattern: '^[A-Z][A-Z0-9_]+-\\d+$' } },
      required: ['issueKey', 'body'],
    });
  });
});

describe('Jira MCP server: tools/call', () => {
  it('searches Jira and returns compact issue views', async () => {
    const { jira, client, records } = await setup();
    const result = await client.callTool({
      name: 'search_issues',
      arguments: { jql: 'project = PLAT', maxResults: 2 },
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result));
    expect(payload.moreResults).toBe(true);
    expect(payload.issues).toEqual([
      expect.objectContaining({ key: 'PLAT-101', status: 'In Progress', assignee: 'Iris Navarro' }),
      expect.objectContaining({ key: 'PLAT-102', assignee: null }),
    ]);
    expect(jira.requests[0]?.body).toMatchObject({ jql: 'project = PLAT', maxResults: 2 });
    expect(records).toEqual([expect.objectContaining({ msg: 'tool call', tool: 'search_issues', outcome: 'ok' })]);
  });

  it('applies the schema default when maxResults is omitted', async () => {
    const { jira, client } = await setup();
    await client.callTool({ name: 'search_issues', arguments: { jql: 'project = PLAT' } });
    expect(jira.requests[0]?.body).toMatchObject({ maxResults: 10 });
  });

  it('adds a comment and says which one', async () => {
    const { jira, client } = await setup();
    const result = await client.callTool({
      name: 'add_comment',
      arguments: { issueKey: 'PLAT-104', body: 'Rolled back to the previous release.' },
    });
    expect(textOf(result)).toBe('Comment 10000 added to PLAT-104.');
    expect(jira.requests).toHaveLength(1);
  });

  it('answers invalid input with a clear error result and never calls Jira', async () => {
    const { jira, client } = await setup();
    const result = await client.callTool({ name: 'add_comment', arguments: { issueKey: 'plat 104', body: '' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'MCP error -32602: Input validation error: Invalid arguments for tool add_comment: ' +
        'expected a Jira issue key such as PLAT-101 at issueKey\n' +
        'Too small: expected string to have >=1 characters at body',
    );
    expect(jira.requests).toHaveLength(0);
  });

  it('passes Jira’s explanation of an invalid JQL back to the model', async () => {
    const { jira, client } = await setup();
    jira.fail({ status: 400, body: { errorMessages: ["Field 'sprintt' does not exist."], errors: {} } });
    const result = await client.callTool({ name: 'search_issues', arguments: { jql: 'sprintt = 12' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "Jira rejected the request as invalid (400). Jira says: Field 'sprintt' does not exist. Correct the input and try again.",
    );
  });

  it('reports a Jira 500 as an error result and keeps answering the next call', async () => {
    const { jira, client, records } = await setup();
    jira.fail({ status: 500, body: { errorMessages: ['Internal server error'] } });

    const failed = await client.callTool({ name: 'search_issues', arguments: { jql: 'project = PLAT' } });
    expect(failed).toMatchObject({ isError: true });
    expect(textOf(failed)).toMatch(/^Jira is unavailable \(500\)\. Try again later\./);

    const next = await client.callTool({ name: 'search_issues', arguments: { jql: 'project = PLAT', maxResults: 1 } });
    expect(next.isError).toBeFalsy();
    expect(records.map((record) => record.outcome)).toEqual(['error', 'ok']);
  });

  it('says the credentials are wrong without revealing them', async () => {
    const { jira, client, records } = await setup();
    jira.fail({ status: 401 });
    const result = await client.callTool({ name: 'search_issues', arguments: { jql: 'project = PLAT' } });
    expect(textOf(result)).toMatch(/rejected the credentials \(401\)/);
    expect(JSON.stringify([result, records])).not.toContain(FAKE_JIRA_CONFIG.apiToken);
  });

  it('reports a comment on a missing issue as an error, not as a success', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'add_comment', arguments: { issueKey: 'PLAT-999', body: 'Hi' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Not found \(404\)\. Jira says: Issue does not exist/);
  });
});

describe('flawed server', () => {
  async function setupProblem() {
    const jira = createFakeJira();
    msw.use(...jira.handlers);
    return { jira, client: await connect(createProblemServer(FAKE_JIRA_CONFIG)) };
  }

  it('publishes one tool with no parameters and no annotations', async () => {
    const { client } = await setupProblem();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(tools[0]?.annotations).toBeUndefined();
  });

  it('posts the comment "undefined" when the model mistypes the action', async () => {
    const { jira, client } = await setupProblem();
    const result = await client.callTool({ name: 'jira', arguments: { action: 'find', issueKey: 'PLAT-104' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(jira.requests[0]?.body)).toContain('"text":"undefined"');
  });

  it('hands the model a TypeError instead of the reason the search failed', async () => {
    const { jira, client } = await setupProblem();
    jira.fail({ status: 401, body: { errorMessages: ['Unauthorized'] } });
    const result = await client.callTool({ name: 'jira', arguments: { action: 'search', jql: 'project = PLAT' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Cannot read properties of undefined/);
  });

  it('reports a comment on a missing issue as added', async () => {
    const { client } = await setupProblem();
    const result = await client.callTool({
      name: 'jira',
      arguments: { action: 'comment', issueKey: 'PLAT-999', body: 'Hi' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/^Comment added: .*Issue does not exist/);
  });
});
