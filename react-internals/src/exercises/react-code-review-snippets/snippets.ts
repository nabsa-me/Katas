import { issues, type Issue } from '../../lib/issues';

/** A short, fixed list for the snippets (sliced once, at module level). */
export const SNIPPET_ISSUES: readonly Issue[] = issues.slice(0, 4);

/** Every assignee, in order of first appearance. */
export const ASSIGNEES: readonly string[] = [...new Set(issues.map((issue) => issue.assignee))];

/** Returns a new array with the item at `index` swapped with the one above it. */
export function moveUp<T>(items: readonly T[], index: number): T[] {
  if (index <= 0 || index >= items.length) return [...items];
  const next = [...items];
  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
  return next;
}

export function issuesFor(items: readonly Issue[], assignee: string): Issue[] {
  return items.filter((issue) => issue.assignee === assignee);
}

/**
 * Returns a new array with the label added, or the same array when there is nothing to add
 * (empty or duplicated), so React can skip the update.
 */
export function addLabel(labels: readonly string[], draft: string): readonly string[] {
  const label = draft.trim().toLowerCase();
  return label === '' || labels.includes(label) ? labels : [...labels, label];
}
