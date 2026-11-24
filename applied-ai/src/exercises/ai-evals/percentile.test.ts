import { describe, expect, it } from 'vitest';
import { percentile } from './percentile';

describe('percentile (nearest rank)', () => {
  const tenValues = [100, 900, 200, 800, 300, 700, 400, 600, 500, 1_000];

  it('returns a measured value, whatever the input order', () => {
    expect(percentile(tenValues, 50)).toBe(500);
    expect(percentile(tenValues, 90)).toBe(900);
    expect(percentile(tenValues, 95)).toBe(1_000);
    expect(percentile(tenValues, 100)).toBe(1_000);
  });

  it('makes p95 of twenty values the second slowest, so one outlier does not hide in it', () => {
    const values = [...Array.from({ length: 18 }, () => 300), 2_000, 9_000];
    expect(percentile(values, 95)).toBe(2_000);
    expect(percentile(values, 50)).toBe(300);
  });

  it('handles a single value and an empty list', () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBeUndefined();
  });

  it('rejects a percentile outside (0, 100]', () => {
    expect(() => percentile(tenValues, 0)).toThrow(RangeError);
    expect(() => percentile(tenValues, 101)).toThrow(RangeError);
  });
});
