import { z } from 'zod';

export const ISSUE_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface Issue {
  key: string;
  title: string;
  status: IssueStatus;
  assignee: string | null;
  updatedAt: string;
}

export interface ListIssuesQuery {
  status: IssueStatus;
  limit: number;
}

/** Port: what the HTTP layer needs from storage. Postgres in the service, stubs in the tests. */
export interface IssueRepository {
  list(query: ListIssuesQuery): Promise<Issue[]>;
  get(key: string): Promise<Issue | undefined>;
}

/** `GET /issues?status=todo&limit=20`: query strings are external data, validated before they reach SQL. */
export const listIssuesQuerySchema = z.object({
  status: z.enum(ISSUE_STATUSES),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** `PLAT-42`: a project key, a dash and a positive number. */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,9}-[1-9]\d{0,8}$/;
