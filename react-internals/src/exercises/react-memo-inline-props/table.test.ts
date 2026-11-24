import { describe, expect, it } from 'vitest';
import type { Issue } from '../../lib/issues';
import { countByStatus, TABLE_ISSUES } from './table';

const issue = (id: string, status: Issue['status']): Issue => ({
  id,
  key: `KEY-${id}`,
  title: 'Title',
  status,
  assignee: 'Someone',
});

describe('countByStatus', () => {
  it('counts every status, including the ones with no issues', () => {
    expect(countByStatus([issue('1', 'todo'), issue('2', 'todo'), issue('3', 'done')])).toEqual({
      todo: 2,
      in_progress: 0,
      done: 1,
    });
  });
});

describe('TABLE_ISSUES', () => {
  it('is a fixed list with unique keys', () => {
    expect(TABLE_ISSUES).toHaveLength(8);
    expect(new Set(TABLE_ISSUES.map((i) => i.key)).size).toBe(8);
  });
});
