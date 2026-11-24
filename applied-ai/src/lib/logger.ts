import { pino, stdTimeFunctions, type DestinationStream, type Level, type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  /** Name of the component, added to every line. */
  name: string;
  level?: Level;
  /**
   * Where the JSON lines go. Defaults to stdout. An MCP server over stdio must pass stderr (`pino.destination(2)`):
   * its stdout is the protocol channel, and a log line there breaks the client.
   */
  destination?: DestinationStream;
}

/**
 * Structured logs: one JSON object per line, with the level as a word and an ISO timestamp, so CloudWatch Logs or
 * any log store can filter and aggregate fields such as `inputTokens` or `latencyMs` without parsing text.
 */
export function createLogger({ name, level = 'info', destination }: LoggerOptions): Logger {
  return pino(
    {
      // Replaces pino's default `pid` and `hostname`: the platform adds those, the component name is ours.
      base: { name },
      level,
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: ['authorization', '*.authorization', 'apiToken', '*.apiToken'], censor: '[redacted]' },
    },
    destination,
  );
}

/** A destination that keeps the parsed lines in memory, for tests that assert what was logged. */
export function memoryDestination() {
  const records: Array<Record<string, unknown>> = [];
  const destination: DestinationStream = { write: (line: string) => void records.push(JSON.parse(line)) };
  return { records, destination };
}
