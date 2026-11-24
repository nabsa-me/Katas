import type { Random } from '../../lib/time';

/** Jira Cloud answers 429 when a rate limit is hit, and some 503s when it is overloaded: both mean "try later". */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export interface RetryPolicy {
  /** Total attempts, the first one included. */
  maxAttempts: number;
  /** First backoff delay when the server gives no `Retry-After`; it doubles on every attempt. */
  baseDelayMs: number;
  /** Upper bound for the exponential backoff. */
  maxDelayMs: number;
  /** Longest `Retry-After` worth waiting for; beyond it, fail and let the caller reschedule the job. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxRetryAfterMs: 60_000,
};

export interface RetryDecisionInput {
  /** Status of the response that just failed. */
  status: number;
  /** Number of the attempt that just failed, starting at 1. */
  attempt: number;
  /** Raw `Retry-After` header, or `null` when absent. */
  retryAfter: string | null;
  random: Random;
  policy?: RetryPolicy;
}

/**
 * How long to wait before the next attempt, or `null` to stop and report the error. Pure, so every rule is tested.
 *
 * - Only 429 and 503 are retried. A 400 is a bad request (an invalid JQL), 401/403 are credentials or permissions,
 *   404 is a missing issue: repeating them changes nothing and only burns rate limit.
 * - `Retry-After` is the server saying when capacity is back, so it is the minimum delay. Jitter is only added on
 *   top (up to +30 %), so that clients throttled at the same moment don't all come back in the same second.
 * - Without the header: exponential backoff (1 s, 2 s, 4 s…, capped) times a jitter factor between 0.7 and 1.3.
 */
export function retryDelayMs({
  status,
  attempt,
  retryAfter,
  random,
  policy = DEFAULT_RETRY_POLICY,
}: RetryDecisionInput): number | null {
  if (!RETRYABLE_STATUSES.has(status) || attempt >= policy.maxAttempts) return null;

  const serverDelayMs = parseRetryAfterMs(retryAfter);
  if (serverDelayMs !== null) {
    if (serverDelayMs > policy.maxRetryAfterMs) return null;
    return Math.ceil(serverDelayMs * (1 + 0.3 * random()));
  }

  const backoffMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(backoffMs * (0.7 + 0.6 * random()));
}

/**
 * `Retry-After` as Jira sends it: a whole number of seconds. Any other value (including the HTTP-date form, which
 * HTTP allows but Jira doesn't use) is ignored and the backoff applies.
 */
export function parseRetryAfterMs(header: string | null): number | null {
  const value = header?.trim();
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value) * 1000;
}
