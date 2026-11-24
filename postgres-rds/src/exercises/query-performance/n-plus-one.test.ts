import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TemporaryDatabase } from '../../lib/database';
import { openIssuesByTeamId, teamDashboard } from './open-issues';
import { teamDashboard as flawedTeamDashboard } from './open-issues.problem';
import { countingQueries } from './query-counter';
import { createSeededDatabase, readSql } from './seed';

let db: TemporaryDatabase;
beforeAll(async () => {
  db = await createSeededDatabase('n_plus_one');
  // A fair comparison: the per-team queries of the flawed version get an index too.
  await db.pool.query(readSql('composite-index.sql'));
});
afterAll(() => db.drop());

describe('dashboard of open issues per team', () => {
  it('the flawed version sends one query for the teams and one more per team (N+1)', async () => {
    const counted = countingQueries(db.pool);
    const dashboard = await flawedTeamDashboard(counted);
    expect(dashboard).toHaveLength(50);
    expect(counted.queries).toBe(1 + 50);
  });

  it('the fixed version sends one query and returns the same numbers', async () => {
    const counted = countingQueries(db.pool);
    const dashboard = await teamDashboard(counted);
    expect(counted.queries).toBe(1);
    expect(dashboard).toEqual(await flawedTeamDashboard(db.pool));
  });

  it('ids from elsewhere are batched with = ANY($1): one query, and teams without open issues get 0', async () => {
    const counted = countingQueries(db.pool);
    const counts = await openIssuesByTeamId(counted, [1, 2, 999]);
    expect(counted.queries).toBe(1);

    const dashboard = await teamDashboard(db.pool);
    expect(counts).toEqual(
      new Map([
        [1, dashboard[0]?.openIssues],
        [2, dashboard[1]?.openIssues],
        [999, 0],
      ]),
    );
  });
});
