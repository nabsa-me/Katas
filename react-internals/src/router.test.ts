import { describe, expect, it } from 'vitest';
import { buildHash, parseHash, slugify } from './router';

describe('parseHash', () => {
  it('returns no route for an empty hash', () => {
    expect(parseHash('').id).toBeNull();
    expect(parseHash('#/').id).toBeNull();
  });

  it('reads the exercise id', () => {
    expect(parseHash('#/stale-closures').id).toBe('stale-closures');
  });

  it('separates the id from the query string', () => {
    const route = parseHash('#/stale-closures?delay=500&step=2');
    expect(route.id).toBe('stale-closures');
    expect(route.query.get('delay')).toBe('500');
    expect(route.query.get('step')).toBe('2');
  });
});

describe('buildHash', () => {
  it('builds a hash without query', () => {
    expect(buildHash('stale-closures')).toBe('#/stale-closures');
  });

  it('builds a hash with query', () => {
    expect(buildHash('stale-closures', new URLSearchParams({ step: '2' }))).toBe('#/stale-closures?step=2');
  });
});

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Stale closures')).toBe('stale-closures');
  });

  it('collapses punctuation and trims hyphens at the ends', () => {
    expect(slugify('  `React.memo` defeated by inline props! ')).toBe('react-memo-defeated-by-inline-props');
  });

  it('removes accents', () => {
    expect(slugify('Revisió de codi')).toBe('revisio-de-codi');
  });
});
