import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { z } from 'zod';
import { CORRELATION_HEADER, correlationIdFrom, runWithContext } from './context';
import { requestMetricsEvent, type EmfEvent } from './emf';
import type { Health } from './health';
import { ISSUE_KEY, listIssuesQuerySchema, type IssueRepository } from './issues';
import type { Logger } from './logger';
import { matchRoute, UNMATCHED_ROUTE, type RouteMatch } from './routes';

export interface AppDependencies {
  issues: IssueRepository;
  health: Health;
  logger: Logger;
  /** Receives one EMF event per request (stdout in the service, an array in the tests). */
  emitMetrics: (event: EmfEvent) => void;
  /** Sends an unexpected error to the error tracker (Sentry in the service, a spy in the tests). */
  reportError: (error: unknown, correlationId: string) => void;
}

interface Reply {
  status: number;
  body: unknown;
}

/**
 * The request lifecycle, in one place: pick or create the correlation id, run the whole request inside its
 * context, answer, and then write exactly one access log line and one metrics event, whatever happened.
 */
export function createApp(deps: AppDependencies): RequestListener {
  return (req, res) => {
    const correlationId = correlationIdFrom(req.headers[CORRELATION_HEADER]);
    runWithContext({ correlationId }, () => {
      // node:http ignores the promise a listener returns: without this catch, a rejection here would be unhandled,
      // and Node ends the process on an unhandled rejection.
      handle(deps, req, res, correlationId).catch((error: unknown) => {
        deps.logger.error({ err: error }, 'request lifecycle failed');
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
  };
}

async function handle(deps: AppDependencies, req: IncomingMessage, res: ServerResponse, correlationId: string) {
  const started = performance.now();
  const method = req.method ?? 'GET';
  const url = URL.parse(req.url ?? '/', 'http://localhost');
  const match = url ? matchRoute(url.pathname) : undefined;
  const route = match?.route ?? UNMATCHED_ROUTE;
  res.setHeader(CORRELATION_HEADER, correlationId);

  let reply: Reply;
  try {
    reply = url ? await dispatch(deps, method, match, url) : { status: 400, body: { error: 'invalid_url' } };
  } catch (error) {
    // Never swallowed: logged with its stack, reported, and answered with the id that finds both.
    deps.logger.error({ err: error, route }, 'request failed');
    deps.reportError(error, correlationId);
    reply = { status: 500, body: { error: 'internal_error', correlationId } };
  }
  res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));

  const latencyMs = performance.now() - started;
  const level = reply.status >= 500 ? 'error' : 'info';
  deps.logger[level]({ method, route, statusCode: reply.status, durationMs: Math.round(latencyMs) }, 'request done');
  deps.emitMetrics(
    requestMetricsEvent({ route, method, statusCode: reply.status, latencyMs, correlationId, timestamp: Date.now() }),
  );
}

async function dispatch(
  { issues, health, logger }: AppDependencies,
  method: string,
  match: RouteMatch | undefined,
  url: URL,
): Promise<Reply> {
  if (!match) return { status: 404, body: { error: 'not_found' } };
  if (method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };

  switch (match.route) {
    case '/healthz':
      return { status: 200, body: health.liveness() };
    case '/readyz': {
      const readiness = await health.readiness();
      if (readiness.status !== 'ready') logger.warn({ readiness }, 'not ready');
      // Names and timings only: the error messages stay in the log line above.
      const checks = readiness.checks.map(({ name, ok, durationMs }) => ({ name, ok, durationMs }));
      return { status: readiness.status === 'ready' ? 200 : 503, body: { status: readiness.status, checks } };
    }
    case '/issues': {
      const query = listIssuesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return { status: 400, body: { error: 'invalid_query', ...z.flattenError(query.error) } };
      return { status: 200, body: { issues: await issues.list(query.data) } };
    }
    case '/issues/:key': {
      const key = match.params.key ?? '';
      if (!ISSUE_KEY.test(key)) return { status: 400, body: { error: 'invalid_issue_key' } };
      const issue = await issues.get(key);
      return issue ? { status: 200, body: issue } : { status: 404, body: { error: 'issue_not_found' } };
    }
  }
}
