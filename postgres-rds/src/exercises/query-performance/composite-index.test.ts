import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TemporaryDatabase } from '../../lib/database';
import { explainAnalyze, indexesUsed, scansOf, sharedBlocks } from './plan';
import { createSeededDatabase, readSql } from './seed';
import { countTeamIssuesInWindow, TEAM_ISSUES_IN_WINDOW } from './team-issues-in-window';

const TEAM = 7;
const FROM = new Date('2026-06-01T00:00:00Z');
const TO = new Date('2026-07-01T00:00:00Z');
const PARAMS = [TEAM, FROM, TO];

let db: TemporaryDatabase;
beforeAll(async () => {
  db = await createSeededDatabase('composite_index');
});
afterAll(() => db.drop());

describe('one team’s issues in a 30-day window', () => {
  it('without an index, Postgres reads the whole table (Seq Scan)', async () => {
    const { plan } = await explainAnalyze(db.pool, TEAM_ISSUES_IN_WINDOW, PARAMS);
    const scanTypes = scansOf(plan, 'issues').map((node) => node['Node Type']);
    expect(scanTypes.length).toBeGreaterThan(0);
    for (const type of scanTypes) expect(type).toMatch(/Seq Scan$/); // "Seq Scan" or "Parallel Seq Scan"
    expect(indexesUsed(plan)).toEqual([]);
  });

  it('equality column first reads a fraction of the pages that range column first needs, for the same answer', async () => {
    const expected = await countTeamIssuesInWindow(db.pool, TEAM, FROM, TO);
    expect(expected).toBeGreaterThan(100);

    await db.pool.query(readSql('composite-index.problem.sql'));
    const rangeFirst = await explainAnalyze(db.pool, TEAM_ISSUES_IN_WINDOW, PARAMS);
    await db.pool.query('DROP INDEX issues_created_at_team_id');

    await db.pool.query(readSql('composite-index.sql'));
    const equalityFirst = await explainAnalyze(db.pool, TEAM_ISSUES_IN_WINDOW, PARAMS);

    expect(indexesUsed(equalityFirst.plan)).toEqual(['issues_team_id_created_at_id']);
    expect(scansOf(equalityFirst.plan, 'issues').map((node) => node['Node Type'])).toEqual(['Index Only Scan']);
    expect(sharedBlocks(equalityFirst.plan) * 5).toBeLessThan(sharedBlocks(rangeFirst.plan));
    expect(await countTeamIssuesInWindow(db.pool, TEAM, FROM, TO)).toBe(expected);
  });
});
