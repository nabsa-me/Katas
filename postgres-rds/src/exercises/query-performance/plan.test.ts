import { describe, expect, it } from 'vitest';
import { indexesUsed, planNodes, scansOf, sharedBlocks, type PlanNode } from './plan';

/** Trimmed from a real `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` of a join. */
const plan: PlanNode = {
  'Node Type': 'Hash Join',
  'Actual Rows': 120,
  'Shared Hit Blocks': 40,
  'Shared Read Blocks': 2,
  Plans: [
    {
      'Node Type': 'Index Scan',
      'Relation Name': 'issues',
      'Index Name': 'issues_team_id_created_at_id',
      'Actual Rows': 120,
      'Shared Hit Blocks': 38,
      'Shared Read Blocks': 2,
    },
    {
      'Node Type': 'Hash',
      Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'teams', 'Actual Rows': 50, 'Shared Hit Blocks': 2 }],
    },
  ],
};

describe('plan helpers', () => {
  it('lists every node depth first, root included', () => {
    expect(planNodes(plan).map((node) => node['Node Type'])).toEqual(['Hash Join', 'Index Scan', 'Hash', 'Seq Scan']);
  });

  it('finds the scans of one table', () => {
    expect(scansOf(plan, 'teams').map((node) => node['Node Type'])).toEqual(['Seq Scan']);
    expect(scansOf(plan, 'issues').map((node) => node['Node Type'])).toEqual(['Index Scan']);
  });

  it('lists the indexes used', () => {
    expect(indexesUsed(plan)).toEqual(['issues_team_id_created_at_id']);
  });

  it('reads total pages from the root, whose counters include its children', () => {
    expect(sharedBlocks(plan)).toBe(42);
  });
});
