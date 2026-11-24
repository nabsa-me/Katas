import { describe, expect, it } from 'vitest';
import data from '../../data/initiatives.json';
import { filterByStatus, parseInitiatives } from './initiative';

describe('parseInitiatives', () => {
  it('keeps every well-formed row of the sample data', () => {
    expect(parseInitiatives(data)).toHaveLength(data.length);
  });

  it('drops incomplete or malformed rows', () => {
    const rows = [
      { id: '1', name: 'Ok', team: 'A', status: 'done', targetDate: '2026-01-01' },
      { id: '2', name: 'Unknown status', team: 'A', status: 'paused', targetDate: '2026-01-01' },
      { id: '3', name: 'Bad date', team: 'A', status: 'done', targetDate: '01/01/2026' },
      { id: 4, name: 'Numeric id', team: 'A', status: 'done', targetDate: '2026-01-01' },
      null,
    ];
    expect(parseInitiatives(rows).map((row) => row.id)).toEqual(['1']);
  });

  it('returns nothing for a payload that is not a list', () => {
    expect(parseInitiatives({ items: [] })).toEqual([]);
  });
});

describe('filterByStatus', () => {
  const items = parseInitiatives(data);

  it('keeps every item for "all"', () => {
    expect(filterByStatus(items, 'all')).toHaveLength(items.length);
  });

  it('keeps the items with the status', () => {
    expect(filterByStatus(items, 'done').every((item) => item.status === 'done')).toBe(true);
  });
});
