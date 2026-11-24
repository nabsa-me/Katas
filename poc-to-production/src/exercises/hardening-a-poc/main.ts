import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { DestinationStream } from 'pino';
import { describeConfig, loadConfig, type Config } from './config';
import { postDailyDigest } from './digest';
import { ConfigError, UpstreamError } from './errors';
import { JiraIssueSource } from './jira-issue-source';
import { createLogger } from './logger';
import { DEFAULT_RETRY_POLICY, type RetryOptions, type RetryPolicy } from './retry';
import { SlackNotifier } from './slack-notifier';

/** Exit codes a scheduler (cron, an ECS scheduled task, a CI job) can alert on and tell apart. */
export const EXIT_CODES = { ok: 0, unexpected: 1, config: 2, upstream: 3 } as const;

/** Everything that comes from outside the process, injectable so tests control time and capture the logs. */
export interface MainDependencies {
  env: Record<string, string | undefined>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  retryPolicy?: RetryPolicy;
  logDestination?: DestinationStream;
}

/**
 * Composition root: the only place that reads the environment, builds the adapters, wires them to the use case
 * and turns the outcome into an exit code. Returns the code instead of calling `process.exit`, so pending log
 * lines are written and the tests can call it.
 */
export async function main(dependencies: MainDependencies): Promise<number> {
  const { env, now = () => new Date(), random = Math.random, retryPolicy = DEFAULT_RETRY_POLICY } = dependencies;
  const { sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), logDestination } = dependencies;

  let config: Config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger('info', logDestination).fatal({ problems: error.problems }, 'invalid configuration, nothing was sent');
    return EXIT_CODES.config;
  }

  const logger = createLogger(config.logLevel, logDestination).child({ runId: randomUUID() });
  logger.info({ config: describeConfig(config) }, 'daily digest started');
  const retry: RetryOptions = {
    policy: retryPolicy,
    sleep,
    random,
    onRetry: ({ attempt, delayMs, error }) =>
      logger.warn(
        { service: error.service, operation: error.operation, code: error.code, attempt, delayMs },
        'transient error, retrying',
      ),
  };
  const source = new JiraIssueSource({ ...config.jira, timeoutMs: config.requestTimeoutMs, retry });
  const chat = new SlackNotifier({ ...config.slack, timeoutMs: config.requestTimeoutMs, retry });

  try {
    const result = await postDailyDigest({ source, chat, projectKey: config.jira.projectKey, today: now() });
    logger.info(result, 'daily digest posted');
    return EXIT_CODES.ok;
  } catch (error) {
    if (error instanceof UpstreamError) {
      logger.error({ err: error }, `${error.service} ${error.operation} failed, the digest was not posted`);
      return EXIT_CODES.upstream;
    }
    logger.fatal({ err: error }, 'unexpected error, the digest was not posted');
    return EXIT_CODES.unexpected;
  }
}

// Runs only when this file is the entry point (`npm run bot`), not when a test or the demo imports it.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main({ env: process.env });
}
