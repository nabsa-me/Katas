import type { Issue, IssueStatus } from '../../lib/issues';

export interface IssueFilters {
  status: IssueStatus | 'all';
  query: string;
}

/**
 * Filters issues by status and by text in the key, title or assignee, ignoring case and accents.
 * It stands for an expensive computation (thousands of rows, sorting, grouping): the exercise is about
 * how many times it runs, not about what it does.
 */
export function expensiveFilter(items: readonly Issue[], filters: IssueFilters): Issue[] {
  const query = normalize(filters.query.trim());
  return items.filter(
    (issue) =>
      (filters.status === 'all' || issue.status === filters.status) &&
      (query === '' || [issue.key, issue.title, issue.assignee].some((text) => normalize(text).includes(query))),
  );
}

/** Lowercase without accents, so "nuria" finds "Núria". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
