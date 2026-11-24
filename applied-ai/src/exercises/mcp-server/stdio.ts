import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pino } from 'pino';
import { createLogger } from '../../lib/logger';
import { loadJiraConfig } from './config';
import { createJiraClient } from './jira-client';
import { createJiraMcpServer } from './server';

/**
 * Entry point for MCP clients that start the server as a child process (Claude Code, Claude Desktop):
 *   npm run mcp
 * Over stdio, stdout carries the JSON-RPC messages and nothing else, so every log line goes to stderr. A missing or
 * invalid variable stops the process at startup with exit code 1, before the client lists any tool.
 */
const logger = createLogger({ name: 'jira-mcp', destination: pino.destination(2) });

try {
  const config = loadJiraConfig();
  const server = createJiraMcpServer({ jira: createJiraClient(config), logger });
  await server.connect(new StdioServerTransport());
  logger.info({ jiraBaseUrl: config.baseUrl }, 'Jira MCP server ready on stdio');
} catch (error) {
  logger.fatal({ err: error }, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
