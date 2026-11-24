import type { z } from 'zod';
import { InvalidResponseError, UpstreamError, type UpstreamService } from './errors';
import { parseRetryAfter } from './retry';

export interface JsonRequest {
  service: UpstreamService;
  operation: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  /**
   * Whether sending the same request twice is harmless. A Jira search is (a read, even over POST); posting to
   * Slack is not (a timeout may hide a message that was posted). It decides what may be retried.
   */
  idempotent: boolean;
}

/** Gateway errors that usually pass. Retried only for idempotent requests; a 429 is always retryable. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

/**
 * POSTs JSON and returns the response body validated by `schema`. Every failure becomes a typed error:
 * no response or a timeout, an HTTP error status, a body that is not JSON, or JSON with an unexpected shape.
 * External data is never trusted: the adapters only see values that passed their schema.
 */
export async function postJson<T>(request: JsonRequest, schema: z.ZodType<T>): Promise<T> {
  const { service, operation, idempotent } = request;
  const transportError = (cause: unknown) =>
    new UpstreamError({
      service,
      operation,
      code: cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'network',
      retryable: idempotent,
      cause,
    });

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      // Without a timeout, a server that never answers hangs the job until the scheduler kills it.
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (cause) {
    throw transportError(cause);
  }

  if (!response.ok) {
    await response.body?.cancel();
    const { status } = response;
    throw new UpstreamError({
      service,
      operation,
      status,
      code: `http_${status}`,
      retryable: status === 429 || (idempotent && TRANSIENT_STATUSES.has(status)),
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), Date.now()),
    });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'TimeoutError') throw transportError(cause);
    throw new InvalidResponseError(service, operation, ['the body is not JSON'], cause);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`);
    throw new InvalidResponseError(service, operation, issues);
  }
  return parsed.data;
}
