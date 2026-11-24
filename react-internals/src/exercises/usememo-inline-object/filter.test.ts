import { describe, expect, it } from 'vitest';
import type { Issue } from '../../lib/issues';
import { expensiveFilter, normalize } from './filter';

const items: Issue[] = [
  { id: '1', key: 'PLAT-101', title: 'Rotate credentials', status: 'todo', assignee: 'Núria Camps' },
  { id: '2', key: 'PLAT-102', title: 'Readiness probe', status: 'done', assignee: 'Pau Serra' },
  { id: '3', key: 'DASH-201', title: 'Theme flash', status: 'todo', assignee: 'Pau Serra' },
];

describe('expensiveFilter', () => {
  it('keeps everything with no status and no text', () => {
    expect(expensiveFilter(items, { status: 'all', query: '' })).toHaveLength(3);
  });

  it('filters by status', () => {
    expect(expensiveFilter(items, { status: 'done', query: '' }).map((i) => i.id)).toEqual(['2']);
  });

  it('searches the key, the title and the assignee, ignoring case and accents', () => {
    expect(expensiveFilter(items, { status: 'all', query: 'dash' }).map((i) => i.id)).toEqual(['3']);
    expect(expensiveFilter(items, { status: 'all', query: 'PROBE' }).map((i) => i.id)).toEqual(['2']);
    expect(expensiveFilter(items, { status: 'all', query: 'nuria' }).map((i) => i.id)).toEqual(['1']);
  });

  it('combines status and text', () => {
    expect(expensiveFilter(items, { status: 'todo', query: 'serra' }).map((i) => i.id)).toEqual(['3']);
  });

  it('returns a new array on every call, which is why recomputing has a cost downstream too', () => {
    const filters = { status: 'all', query: '' } as const;
    expect(expensiveFilter(items, filters)).not.toBe(expensiveFilter(items, filters));
  });
});

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('Núria Ferrer')).toBe('nuria ferrer');
  });
});
