/**
 * `npm run explain`: seeds a temporary database with 100,000 issues and prints, case by case, the plan
 * and timing before and after the fix. The database is dropped at the end.
 */
import { START_POSTGRES_HINT, type Queryable } from '../../lib/database';
import { teamDashboard } from './open-issues';
import { teamDashboard as flawedTeamDashboard } from './open-issues.problem';
import { KEYSET_PAGE_SQL } from './pagination';
import { OFFSET_PAGE_SQL, teamIssuesPage } from './pagination.problem';
import { explainAnalyzeText } from './plan';
import { countingQueries } from './query-counter';
import { createSeededDatabase, readSql } from './seed';
import { TEAM_ISSUES_IN_WINDOW } from './team-issues-in-window';

const TEAM = 7;
const WINDOW = [TEAM, new Date('2026-06-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z')];
const PAGE_SIZE = 20;

function heading(title: string): void {
  console.log(`\n${'='.repeat(100)}\n${title}\n${'='.repeat(100)}`);
}

async function showPlan(db: Queryable, label: string, sql: string, params: unknown[]): Promise<void> {
  console.log(`\n--- ${label}\n${await explainAnalyzeText(db, sql, params)}`);
}

async function timeDashboard(db: Queryable, label: string, dashboard: typeof teamDashboard): Promise<void> {
  await dashboard(db); // warm-up, so both versions are measured with a warm cache
  const counted = countingQueries(db);
  const start = performance.now();
  await dashboard(counted);
  const queries = counted.queries === 1 ? '1 query' : `${counted.queries} queries`;
  console.log(`${label}: ${queries}, ${(performance.now() - start).toFixed(1)} ms`);
}

async function main(): Promise<void> {
  console.log('Seeding 50 teams and 100,000 issues…');
  const db = await createSeededDatabase('explain');
  try {
    heading('Composite index: how many issues team 7 opened in June');
    await showPlan(db.pool, 'No index', TEAM_ISSUES_IN_WINDOW, WINDOW);
    await db.pool.query(readSql('composite-index.problem.sql'));
    await showPlan(db.pool, 'Range column first: (created_at, team_id)', TEAM_ISSUES_IN_WINDOW, WINDOW);
    await db.pool.query('DROP INDEX issues_created_at_team_id');
    await db.pool.query(readSql('composite-index.sql'));
    await showPlan(db.pool, 'Equality column first: (team_id, created_at, id)', TEAM_ISSUES_IN_WINDOW, WINDOW);

    heading('N+1: open issues per team (the index above is in place for both)');
    await timeDashboard(db.pool, 'One query per team', flawedTeamDashboard);
    await timeDashboard(db.pool, 'One query with a join', teamDashboard);
    console.log('Over a network each extra round trip adds its latency on top: up to about 1 ms per query across AZs.');

    heading('Pagination: page 90 of team 7, 20 issues per page');
    const last = (await teamIssuesPage(db.pool, TEAM, 89, PAGE_SIZE)).at(-1);
    if (!last) throw new Error('Page 89 is empty');
    await showPlan(db.pool, 'OFFSET 1780', OFFSET_PAGE_SQL, [TEAM, PAGE_SIZE, 89 * PAGE_SIZE]);
    await showPlan(db.pool, 'Keyset after the last row of page 89', KEYSET_PAGE_SQL, [
      TEAM,
      last.createdAt,
      last.id,
      PAGE_SIZE,
    ]);
  } finally {
    await db.drop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  console.error(`\nIf Postgres is not running: ${START_POSTGRES_HINT}`);
  process.exitCode = 1;
});
