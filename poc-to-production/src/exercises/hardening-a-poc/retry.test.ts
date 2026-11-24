import { describe, expect, it, vi } from 'vitest';
import { UpstreamError, type UpstreamErrorDetails } from './errors';
import { parseRetryAfter, retryDelayMs, withRetry, type RetryPolicy } from './retry';

const policy: RetryPolicy = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 30_000 };
const noJitter = () => 0.5;

function upstream(details: Partial<UpstreamErrorDetails> = {}) {
  return new UpstreamError({
    service: 'jira',
    operation: 'search issues',
    code: 'http_503',
    retryable: true,
    ...details,
  });
}

/** Sleeps that only record the delay: the tests check the waits without waiting. */
function recordedSleeps() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-24T08:00:00Z');

  it('reads seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
  });

  it('reads an HTTP date, relative to now', () => {
    expect(parseRetryAfter('Tue, 24 Nov 2026 08:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Tue, 24 Nov 2026 07:59:00 GMT', now)).toBe(0);
  });

  it('ignores an absent or unreadable header', () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('', now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});

describe('retryDelayMs', () => {
  it('doubles from the base delay and stops at the cap', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, policy, noJitter))).toEqual([500, 1000, 2000, 4000]);
    expect(retryDelayMs(10, policy, noJitter)).toBe(30_000);
  });

  it('spreads the delay between ×0.7 and ×1.3', () => {
    expect(retryDelayMs(2, policy, () => 0)).toBe(700);
    expect(retryDelayMs(2, policy, () => 1)).toBe(1300);
  });

  it('never waits less than Retry-After', () => {
    expect(retryDelayMs(1, policy, noJitter, 5_000)).toBe(5_000);
  });
});

describe('withRetry', () => {
  it('retries a retryable error and returns the first success', async () => {
    const { delays, sleep } = recordedSleeps();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(upstream())
      .mockRejectedValueOnce(upstream())
      .mockResolvedValue('ok');
    await expect(withRetry(operation, { policy, sleep, random: noJitter })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('waits what Retry-After asks for and reports each retry', async () => {
    const { delays, sleep } = recordedSleeps();
    const onRetry = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(upstream({ status: 429, retryAfterMs: 3_000 }))
      .mockResolvedValue(1);
    await withRetry(operation, { policy, sleep, random: noJitter, onRetry });
    expect(delays).toEqual([3_000]);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, delayMs: 3_000 }));
  });

  it('throws a non-retryable error at once', async () => {
    const { delays, sleep } = recordedSleeps();
    const error = upstream({ status: 401, code: 'http_401', retryable: false });
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withRetry(operation, { policy, sleep, random: noJitter })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('does not retry errors it does not know, such as a bug in the code', async () => {
    const operation = vi.fn().mockRejectedValue(new TypeError('undefined is not a function'));
    await expect(withRetry(operation, { policy, ...recordedSleeps(), random: noJitter })).rejects.toThrow(TypeError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts with the last error', async () => {
    const operation = vi.fn().mockRejectedValue(upstream());
    await expect(withRetry(operation, { policy, ...recordedSleeps(), random: noJitter })).rejects.toThrow(
      UpstreamError,
    );
    expect(operation).toHaveBeenCalledTimes(policy.maxAttempts);
  });

  it('gives up when Retry-After is longer than the cap, instead of hanging the job', async () => {
    const { delays, sleep } = recordedSleeps();
    const operation = vi.fn().mockRejectedValue(upstream({ status: 429, retryAfterMs: 3_600_000 }));
    await expect(withRetry(operation, { policy, sleep, random: noJitter })).rejects.toThrow(UpstreamError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});
