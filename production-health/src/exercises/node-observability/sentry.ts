import * as Sentry from '@sentry/node';
import type { Config } from './config';

/**
 * Sentry options, or `undefined` when no DSN is configured: locally and in the tests nothing is initialised and
 * nothing leaves the machine. `dataCollection` (Sentry 11, replacing `sendDefaultPii`) is set explicitly and
 * conservatively: no user data, cookies, bodies or local variables; only the headers and query parameters this
 * service needs to understand an error.
 */
export function sentryOptions(config: Pick<Config, 'sentry'>): Sentry.NodeOptions | undefined {
  if (!config.sentry) return undefined;
  return {
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    // A sample of requests as performance traces; errors are always sent, whatever this rate.
    tracesSampleRate: 0.1,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'x-correlation-id'] }, response: false },
      httpBodies: [],
      urlQueryParams: { allow: ['status', 'limit'] },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  };
}

/**
 * The error handler's hook into Sentry, tagged with the correlation id so an event links to its log lines. Without
 * `Sentry.init` (no DSN) there is no client and the call does nothing.
 */
export function reportToSentry(error: unknown, correlationId: string): void {
  Sentry.captureException(error, { tags: { correlationId } });
}
