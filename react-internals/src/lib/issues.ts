import data from '../data/issues.json';

export type IssueStatus = 'todo' | 'in_progress' | 'done';

export interface Issue {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  assignee: string;
}

export const STATUS_LABELS: Record<IssueStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/**
 * Fictional issues. Declared at module level, so the array keeps the same reference for the whole
 * life of the app: a stable input for the memoization exercises.
 */
export const issues = data as Issue[];
