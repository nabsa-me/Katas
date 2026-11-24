import type { Queryable } from '../../lib/database';

export interface TeamOpenIssues {
  team: string;
  openIssues: number;
}

/**
 * Flawed: one query for the teams, then one more per team (N+1). Each query is fast on its own, but 50
 * teams are 51 round trips, and the page gets slower with every team added.
 */
export async function teamDashboard(db: Queryable): Promise<TeamOpenIssues[]> {
  const teams = await db.query<{ id: number; name: string }>('SELECT id, name FROM teams ORDER BY id');
  const dashboard: TeamOpenIssues[] = [];
  for (const team of teams.rows) {
    const { rows } = await db.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM issues WHERE team_id = $1 AND status <> 'done'`,
      [team.id],
    );
    dashboard.push({ team: team.name, openIssues: rows[0]?.open ?? 0 });
  }
  return dashboard;
}
