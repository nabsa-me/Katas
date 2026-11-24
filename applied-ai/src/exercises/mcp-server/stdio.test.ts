import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The same command an MCP client runs: Node, tsx's CLI and the entry file, all by absolute path, so it works from
// any working directory (the test starts it from the system temp folder).
const TSX_CLI = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const STDIO_ENTRY = fileURLToPath(new URL('./stdio.ts', import.meta.url));

// Only the variables an MCP client passes: the safe defaults (PATH and the like) plus the server's own.
const FAKE_ENV = {
  ...getDefaultEnvironment(),
  JIRA_BASE_URL: 'https://katas-example.atlassian.net',
  JIRA_EMAIL: 'ada@example.com',
  JIRA_API_TOKEN: 'replace-with-an-api-token',
};

describe('stdio entry point', () => {
  it('starts as a child process, lists its tools over stdio and logs only to stderr', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [TSX_CLI, STDIO_ENTRY],
      cwd: tmpdir(),
      env: FAKE_ENV,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const errors: Error[] = [];
    const client = new Client({ name: 'kata-test-client', version: '1.0.0' });
    client.onerror = (error) => errors.push(error);

    await client.connect(transport);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((tool) => tool.name)).toEqual(['search_issues', 'add_comment']);
    expect(errors).toEqual([]); // stdout carried JSON-RPC messages only
    expect(stderr).toContain('"msg":"Jira MCP server ready on stdio"');
    expect(stderr).not.toContain(FAKE_ENV.JIRA_API_TOKEN);
  }, 30_000);

  it('exits with code 1 and names the missing variables when the configuration is incomplete', () => {
    const withoutToken = Object.fromEntries(Object.entries(FAKE_ENV).filter(([name]) => name !== 'JIRA_API_TOKEN'));
    const run = spawnSync(process.execPath, [TSX_CLI, STDIO_ENTRY], {
      cwd: tmpdir(),
      env: withoutToken,
      input: '',
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/Invalid Jira configuration[\s\S]*JIRA_API_TOKEN/);
  }, 30_000);
});
