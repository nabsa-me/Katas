import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TemporaryDatabase } from '../../lib/database';
import { decodeCursor, encodeCursor, KEYSET_PAGE_SQL, teamIssuesAfter, type Cursor } from './pagination';
import { OFFSET_PAGE_SQL, teamIssuesPage, type IssueRow } from './pagination.problem';
import { explainAnalyze, indexesUsed, scansOf } from './plan';
import { createSeededDatabase, readSql } from './seed';

const TEAM = 7;
const PAGE_SIZE = 20;

let db: TemporaryDatabase;
beforeAll(async () => {
  db = await createSeededDatabase('pagination');
  await db.pool.query(readSql('composite-index.sql'));
});
afterAll(() => db.drop());

const ids = (rows: IssueRow[]) => rows.map((row) => row.id);

describe('keyset pagination', () => {
  it('walks every issue of the team exactly once, newest first', async () => {
    const seen: IssueRow[] = [];
    let cursor: Cursor | null = null;
    do {
      const page = await teamIssuesAfter(db.pool, TEAM, cursor, 100);
      seen.push(...page.issues);
      cursor = page.next;
    } while (cursor);

    expect(seen).toHaveLength(2_000);
    expect(new Set(ids(seen)).size).toBe(2_000);
    const times = seen.map((row) => row.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('an issue created while the user pages makes OFFSET repeat a row; keyset does not', async () => {
    const offsetFirst = await teamIssuesPage(db.pool, TEAM, 1, PAGE_SIZE);
    const keysetFirst = await teamIssuesAfter(db.pool, TEAM, null, PAGE_SIZE);
    expect(ids(keysetFirst.issues)).toEqual(ids(offsetFirst));

    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO issues (team_id, status, title, created_at)
       VALUES ($1, 'todo', 'Created while paging', '2027-01-01') RETURNING id`,
      [TEAM],
    );
    try {
      const offsetSecond = await teamIssuesPage(db.pool, TEAM, 2, PAGE_SIZE);
      const keysetSecond = await teamIssuesAfter(db.pool, TEAM, keysetFirst.next, PAGE_SIZE);

      expect(offsetSecond[0]?.id).toBe(offsetFirst.at(-1)?.id); // seen twice
      expect(ids(keysetSecond.issues).some((id) => ids(keysetFirst.issues).includes(id))).toBe(false);
    } finally {
      await db.pool.query('DELETE FROM issues WHERE id = $1', [rows[0]?.id]);
    }
  });

  it('page 90 with OFFSET reads every row before it; with keyset it reads one page', async () => {
    const page89 = await teamIssuesPage(db.pool, TEAM, 89, PAGE_SIZE);
    const last = page89.at(-1);
    if (!last) throw new Error('Page 89 is empty');

    const offset = await explainAnalyze(db.pool, OFFSET_PAGE_SQL, [TEAM, PAGE_SIZE, 89 * PAGE_SIZE]);
    const keyset = await explainAnalyze(db.pool, KEYSET_PAGE_SQL, [TEAM, last.createdAt, last.id, PAGE_SIZE]);

    const rowsRead = (plan: typeof offset.plan) => scansOf(plan, 'issues')[0]?.['Actual Rows'] ?? 0;
    expect(rowsRead(offset.plan)).toBeGreaterThanOrEqual(89 * PAGE_SIZE + PAGE_SIZE);
    expect(rowsRead(keyset.plan)).toBe(PAGE_SIZE);
    expect(indexesUsed(keyset.plan)).toEqual(['issues_team_id_created_at_id']);

    // Same rows either way.
    const offsetPage90 = await teamIssuesPage(db.pool, TEAM, 90, PAGE_SIZE);
    const keysetPage90 = await teamIssuesAfter(db.pool, TEAM, { createdAt: last.createdAt, id: last.id }, PAGE_SIZE);
    expect(ids(keysetPage90.issues)).toEqual(ids(offsetPage90));
  });
});

describe('cursor encoding', () => {
  const cursor: Cursor = { createdAt: new Date('2026-06-01T10:20:30.123Z'), id: '4321' };

  it('round-trips through an opaque, URL-safe string', () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('rejects cursors a client tampered with', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const tampered of [
      'not base64 json',
      encode({ createdAt: '2026-06-01', id: '1' }),
      encode(['yesterday', '1']),
      encode(['2026-06-01T00:00:00Z', '1 OR 1=1']),
      encode(['2026-06-01T00:00:00Z', 42]),
    ]) {
      expect(() => decodeCursor(tampered), tampered).toThrow('Invalid cursor');
    }
  });
});
