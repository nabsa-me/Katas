import { describe, expect, it } from 'vitest';
import { caseHref, CASES, findCase, isVariant } from './cases';
import { formatTimestamp, LAST_SYNC } from './format';

describe('mismatch cases', () => {
  it('have unique, URL-safe slugs', () => {
    const slugs = CASES.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.every((slug) => /^[a-z]+(-[a-z]+)*$/.test(slug))).toBe(true);
  });

  it('are found by slug, and unknown slugs are not', () => {
    expect(findCase('random-ids')?.title).toBe('Random ids');
    expect(findCase('nope')).toBeUndefined();
  });

  it('accept only the two variants', () => {
    expect(isVariant('problem')).toBe(true);
    expect(isVariant('solution')).toBe(true);
    expect(isVariant('other')).toBe(false);
  });

  it('build the route of each variant', () => {
    expect(caseHref('random-ids', 'solution')).toBe('/hydration-mismatch-catalog/random-ids/solution');
  });
});

describe('formatTimestamp', () => {
  it('does not depend on the time zone or the locale of the machine', () => {
    expect(formatTimestamp(LAST_SYNC)).toBe('24 Nov 2026, 08:30 UTC');
  });
});
