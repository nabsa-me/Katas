import type { Queryable } from '../../lib/database';

/** A dashboard tile: how many issues a team opened in a time window. Equality on team_id, range on created_at. */
export const TEAM_ISSUES_IN_WINDOW = `
  SELECT count(*)::int AS issues
  FROM issues
  WHERE team_id = $1 AND created_at >= $2 AND created_at < $3`;

export async function countTeamIssuesInWindow(db: Queryable, teamId: number, from: Date, to: Date): Promise<number> {
  const { rows } = await db.query<{ issues: number }>(TEAM_ISSUES_IN_WINDOW, [teamId, from, to]);
  return rows[0]?.issues ?? 0;
}
