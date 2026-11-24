import { describe, expect, it } from 'vitest';
import type { Issue } from '../../lib/issues';
import { addLabel, issuesFor, moveUp } from './snippets';

describe('moveUp', () => {
  it('swaps the item with the one above it, in a new array', () => {
    const items = ['a', 'b', 'c'];
    const moved = moveUp(items, 2);
    expect(moved).toEqual(['a', 'c', 'b']);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('leaves the first item and out-of-range indexes alone', () => {
    expect(moveUp(['a', 'b'], 0)).toEqual(['a', 'b']);
    expect(moveUp(['a', 'b'], 5)).toEqual(['a', 'b']);
  });
});

describe('issuesFor', () => {
  it('keeps the issues of one assignee', () => {
    const items = [
      { id: '1', assignee: 'Pau Serra' },
      { id: '2', assignee: 'Laia Ferrer' },
      { id: '3', assignee: 'Pau Serra' },
    ] as Issue[];
    expect(issuesFor(items, 'Pau Serra').map((i) => i.id)).toEqual(['1', '3']);
  });
});

describe('addLabel', () => {
  it('adds a trimmed, lowercased label in a new array', () => {
    const labels = ['backend'];
    expect(addLabel(labels, '  Urgent ')).toEqual(['backend', 'urgent']);
    expect(labels).toEqual(['backend']);
  });

  it('returns the same array for empty or duplicated labels', () => {
    const labels = ['backend'];
    expect(addLabel(labels, '   ')).toBe(labels);
    expect(addLabel(labels, 'Backend')).toBe(labels);
  });
});
