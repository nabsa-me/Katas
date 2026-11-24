import { describe, expect, it } from 'vitest';
import { safeEqual } from './timing-safe';

describe('safeEqual', () => {
  it('is true for identical strings', () => {
    expect(safeEqual('v0=abc123', 'v0=abc123')).toBe(true);
  });

  it('is false for strings of the same length that differ', () => {
    expect(safeEqual('v0=abc123', 'v0=abc124')).toBe(false);
  });

  it('is false, without throwing, for strings of different length', () => {
    expect(safeEqual('v0=abc', 'v0=abc123')).toBe(false);
    expect(safeEqual('', 'v0=abc')).toBe(false);
  });
});
