import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY, parseRetryAfterMs, retryDelayMs } from './retry-policy';

const noJitter = () => 0.5; // jitter factor 0.7 + 0.6 * 0.5 = 1
const lowest = () => 0;
const highest = () => 0.999999;

describe('retryDelayMs', () => {
  it('waits exactly Retry-After when the jitter is zero', () => {
    expect(retryDelayMs({ status: 429, attempt: 1, retryAfter: '2', random: lowest })).toBe(2000);
  });

  it('never waits less than Retry-After, and at most 30 % more', () => {
    expect(retryDelayMs({ status: 429, attempt: 1, retryAfter: '10', random: highest })).toBeLessThanOrEqual(13_000);
    for (const random of [lowest, noJitter, highest]) {
      expect(retryDelayMs({ status: 429, attempt: 1, retryAfter: '10', random })).toBeGreaterThanOrEqual(10_000);
    }
  });

  it('uses Retry-After on a 503 too', () => {
    expect(retryDelayMs({ status: 503, attempt: 2, retryAfter: '3', random: lowest })).toBe(3000);
  });

  it('backs off exponentially without Retry-After', () => {
    const delays = [1, 2, 3, 4].map((attempt) =>
      retryDelayMs({ status: 503, attempt, retryAfter: null, random: noJitter }),
    );
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('applies a jitter factor between 0.7 and 1.3 to the backoff', () => {
    expect(retryDelayMs({ status: 429, attempt: 2, retryAfter: null, random: lowest })).toBe(1400);
    expect(retryDelayMs({ status: 429, attempt: 2, retryAfter: null, random: highest })).toBe(2600);
  });

  it('caps the backoff at maxDelayMs', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 20 };
    expect(retryDelayMs({ status: 429, attempt: 10, retryAfter: null, random: noJitter, policy })).toBe(30_000);
  });

  it('stops after the last attempt', () => {
    expect(retryDelayMs({ status: 429, attempt: 5, retryAfter: '1', random: noJitter })).toBeNull();
  });

  it('does not retry statuses that repeating cannot fix', () => {
    for (const status of [400, 401, 403, 404, 500]) {
      expect(retryDelayMs({ status, attempt: 1, retryAfter: '1', random: noJitter })).toBeNull();
    }
  });

  it('gives up when the server asks for a longer wait than the policy accepts', () => {
    expect(retryDelayMs({ status: 429, attempt: 1, retryAfter: '3600', random: noJitter })).toBeNull();
  });

  it('falls back to the backoff when Retry-After is not a number of seconds', () => {
    expect(retryDelayMs({ status: 429, attempt: 1, retryAfter: 'soon', random: noJitter })).toBe(1000);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads whole seconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
    expect(parseRetryAfterMs(' 0 ')).toBe(0);
  });

  it('ignores missing and non-numeric values', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('-1')).toBeNull();
    expect(parseRetryAfterMs('1.5')).toBeNull();
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
  });
});
