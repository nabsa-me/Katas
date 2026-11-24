import { describe, expect, it } from 'vitest';
import { buildHash, parseHash, slugify } from './router';

describe('parseHash', () => {
  it('returns no route for an empty hash', () => {
    expect(parseHash('').id).toBeNull();
    expect(parseHash('#/').id).toBeNull();
  });

  it('reads the exercise id', () => {
    expect(parseHash('#/clustering').id).toBe('clustering');
  });

  it('separates the id from the query string', () => {
    const route = parseHash('#/integrated-viewer?z=9&type=school');
    expect(route.id).toBe('integrated-viewer');
    expect(route.query.get('z')).toBe('9');
    expect(route.query.get('type')).toBe('school');
  });
});

describe('buildHash', () => {
  it('builds a hash without query', () => {
    expect(buildHash('base-map-and-controls')).toBe('#/base-map-and-controls');
  });

  it('builds a hash with query', () => {
    expect(buildHash('integrated-viewer', new URLSearchParams({ z: '9' }))).toBe('#/integrated-viewer?z=9');
  });
});

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('ICGC WMS layer')).toBe('icgc-wms-layer');
  });

  it('collapses punctuation and trims hyphens at the ends', () => {
    expect(slugify('  Data-driven style! ')).toBe('data-driven-style');
  });

  it('removes accents', () => {
    expect(slugify('Mapa topogràfic')).toBe('mapa-topografic');
  });
});
