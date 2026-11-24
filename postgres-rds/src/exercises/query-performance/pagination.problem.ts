import type { Queryable } from '../../lib/database';

export interface IssueRow {
  id: string;
  title: string;
  createdAt: Date;
}

export const OFFSET_PAGE_SQL = `
  SELECT id, title, created_at AS "createdAt"
  FROM issues
  WHERE team_id = $1
  ORDER BY created_at DESC, id DESC
  LIMIT $2 OFFSET $3`;

/**
 * Flawed: OFFSET pagination. To return page 90 the database reads and discards the 89 pages before it,
 * so every page is slower than the previous one. And a row inserted while the user is paging shifts
 * every later page by one: the next page repeats the last row the user already saw.
 */
export async function teamIssuesPage(db: Queryable, teamId: number, page: number, pageSize = 20): Promise<IssueRow[]> {
  const { rows } = await db.query<IssueRow>(OFFSET_PAGE_SQL, [teamId, pageSize, (page - 1) * pageSize]);
  return rows;
}
