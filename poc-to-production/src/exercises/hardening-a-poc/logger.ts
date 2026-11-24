import { pino, stdTimeFunctions, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config';

export type { Logger };

/**
 * Paths censored in every log line. Redaction is the safety net, not the plan: the code logs safe summaries
 * (`describeConfig`) and never headers. Paths are case-sensitive, hence `headers.*` rather than the header name.
 */
export const REDACTED_PATHS = [
  'headers.*',
  '*.headers.*',
  'authorization',
  '*.authorization',
  'apiToken',
  '*.apiToken',
  '*.*.apiToken',
  'botToken',
  '*.botToken',
  '*.*.botToken',
];

/**
 * Structured logs: one JSON object per line on stdout, which CloudWatch Logs, Datadog or Loki index without
 * parsing. The level as a word (`"level":"warn"`) and ISO timestamps keep the lines readable when you grep them.
 * `destination` exists for tests, which collect the lines instead of printing them.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'jira-slack-digest' },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
    destination,
  );
}
