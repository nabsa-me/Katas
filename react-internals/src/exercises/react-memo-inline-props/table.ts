import { issues, type Issue } from '../../lib/issues';

export type Column = keyof Pick<Issue, 'key' | 'title' | 'assignee'>;

/**
 * The rows the table shows. Sliced once, at module level: a `.slice()` inside the component would be
 * a new array on every render, the same mistake this exercise is about.
 */
export const TABLE_ISSUES: readonly Issue[] = issues.slice(0, 8);

/** Count of issues per status, for the summary panel. */
export function countByStatus(items: readonly Issue[]): Record<Issue['status'], number> {
  const counts: Record<Issue['status'], number> = { todo: 0, in_progress: 0, done: 0 };
  for (const issue of items) counts[issue.status] += 1;
  return counts;
}
