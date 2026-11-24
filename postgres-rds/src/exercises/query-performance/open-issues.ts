import type { Queryable } from '../../lib/database';
import type { TeamOpenIssues } from './open-issues.problem';

/** One round trip whatever the number of teams: the database joins and counts. */
export async function teamDashboard(db: Queryable): Promise<TeamOpenIssues[]> {
  const { rows } = await db.query<TeamOpenIssues>(`
    SELECT t.name AS team, count(i.id) FILTER (WHERE i.status <> 'done')::int AS "openIssues"
    FROM teams AS t
    LEFT JOIN issues AS i ON i.team_id = t.id
    GROUP BY t.id
    ORDER BY t.id`);
  return rows;
}

/**
 * When the ids come from somewhere else (another service, a GraphQL loader), batch them into one query
 * with `= ANY($1)` instead of looping. Teams without open issues are returned with 0.
 */
export async function openIssuesByTeamId(db: Queryable, teamIds: readonly number[]): Promise<Map<number, number>> {
  const { rows } = await db.query<{ team_id: number; open: number }>(
    `SELECT team_id, count(*)::int AS open
     FROM issues
     WHERE team_id = ANY($1::int[]) AND status <> 'done'
     GROUP BY team_id`,
    [teamIds],
  );
  const counts = new Map(teamIds.map((id) => [id, 0]));
  for (const row of rows) counts.set(row.team_id, row.open);
  return counts;
}
