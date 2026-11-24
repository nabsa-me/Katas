import { pino } from 'pino';
import { createLogger } from '../../lib/logger';
import { ConfigError, createBedrockClient, loadBedrockConfig } from './bedrock-client';
import { converse, ConversationError, SYSTEM_PROMPT } from './conversation';
import { streamAnswer } from './stream';
import { issueTools } from './tools';

/**
 * Real mode, optional: asks Claude on Amazon Bedrock with your AWS credentials and `.env`.
 *   npm run ask -- "What is the status of PLAT-104?"
 *   npm run ask -- --stream "Write a two-line summary of what a release checklist is for."
 * The answer goes to stdout and the log lines to stderr, so the answer can be piped. Exit codes: 0 answered,
 * 1 unexpected error, 2 invalid configuration, 3 no complete answer (truncated, blocked or an unusable stop).
 */
async function main(args: string[]): Promise<number> {
  const stream = args.includes('--stream');
  const question = args.filter((arg) => arg !== '--stream').join(' ');
  if (!question) {
    process.stderr.write('Usage: npm run ask -- [--stream] "your question"\n');
    return 2;
  }

  const config = loadBedrockConfig();
  const client = createBedrockClient(config);
  const logger = createLogger({ name: 'claude-bedrock', destination: pino.destination(2) });
  const options = { client, modelId: config.modelId, maxTokens: config.maxTokens, system: SYSTEM_PROMPT, logger };

  try {
    if (stream) {
      const result = await streamAnswer(question, { ...options, onText: (text) => process.stdout.write(text) });
      process.stdout.write('\n');
      return result.stopReason === 'end_turn' ? 0 : 3;
    }
    const result = await converse(question, { ...options, tools: issueTools });
    process.stdout.write(`${result.text}\n`);
    return result.outcome === 'answered' ? 0 : 3;
  } finally {
    client.destroy();
  }
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof ConfigError ? 2 : error instanceof ConversationError ? 3 : 1;
  },
);
