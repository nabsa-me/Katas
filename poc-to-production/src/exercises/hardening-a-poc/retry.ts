import { UpstreamError } from './errors';

export interface RetryPolicy {
  /** Total attempts, the first one included. */
  maxAttempts: number;
  baseDelayMs: number;
  /** Longest wait between attempts. A `Retry-After` above it means giving up: a daily job should fail and alert. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 30_000 };

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: UpstreamError;
}

/** Time and randomness are injected, so tests assert the exact delays without waiting or fake timers. */
export interface RetryOptions {
  policy: RetryPolicy;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  onRetry?: (info: RetryInfo) => void;
}

/**
 * `Retry-After` comes as seconds (`120`) or as an HTTP date (`Wed, 21 Oct 2026 07:28:00 GMT`).
 * Returns milliseconds from `now`, or `undefined` when the header is absent or unreadable.
 */
export function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Exponential backoff (base, 2×base, 4×base…) capped at `maxDelayMs`, with jitter between ×0.7 and ×1.3 so that
 * many clients that failed together do not retry together. `Retry-After`, when present, is the minimum.
 */
export function retryDelayMs(attempt: number, policy: RetryPolicy, random: () => number, retryAfterMs?: number) {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = Math.round(exponential * (0.7 + 0.6 * random()));
  return Math.max(retryAfterMs ?? 0, Math.min(policy.maxDelayMs, jittered));
}

/**
 * Runs `operation` and tries again only when the error says it is safe (`UpstreamError.retryable`): a 429, or
 * a 5xx or a timeout on an idempotent read. Anything else is thrown at once, unchanged.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { policy, sleep, random, onRetry } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof UpstreamError) || !error.retryable || attempt >= policy.maxAttempts) throw error;
      if (error.retryAfterMs !== undefined && error.retryAfterMs > policy.maxDelayMs) throw error;
      const delayMs = retryDelayMs(attempt, policy, random, error.retryAfterMs);
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
