import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** What every log line written while handling a request needs to know about that request. */
export interface RequestContext {
  correlationId: string;
}

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Letters, digits and `._:-`, at most 128 characters: enough for a UUID, a ULID or an AWS request id. The id ends
 * up in every log line and in a response header, so a newline (forged log lines), a control character (Node
 * rejects the header and the request fails) or 10 KB of text (in every line) must not get through.
 */
const SAFE_ID = /^[\w.:-]{1,128}$/;

/** Reuses the caller's id when it is safe, so one id follows the request across services; otherwise makes one. */
export function correlationIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && SAFE_ID.test(value) ? value : randomUUID();
}

/**
 * One store per request. `AsyncLocalStorage` follows the asynchronous work started inside `run()` (awaits,
 * timers, promises, the database driver's callbacks), so code deep in the call stack can read the current request
 * without receiving it as a parameter.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The context of the request being handled, or `undefined` outside a request (startup, shutdown). */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` with no request context. Callbacks of a socket run in the context where the socket was created: when
 * an idle database connection drops, its `error` event carries the id of the request that happened to open it,
 * minutes earlier. Events that belong to no request go through here so their log lines don't blame one.
 */
export function runOutsideContext<T>(fn: () => T): T {
  return storage.exit(fn);
}
