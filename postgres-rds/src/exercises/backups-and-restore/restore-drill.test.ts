import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminConnectionString,
  createTemporaryDatabase,
  randomSuffix,
  withClient,
  type TemporaryDatabase,
} from '../../lib/database';
import { compareCounts, countRows } from './row-counts';

const execFileAsync = promisify(execFile);
const kataRoot = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(new URL('./restore-drill.ts', import.meta.url));

describe('compareCounts', () => {
  it('finds nothing when every table matches', () => {
    expect(compareCounts({ teams: 4, people: 40 }, { people: 40, teams: 4 })).toEqual([]);
  });

  it('reports tables with different counts, and tables missing on either side', () => {
    expect(compareCounts({ teams: 4, people: 40, initiatives: 12 }, { teams: 4, people: 39, audit: 1 })).toEqual([
      { table: 'audit', before: undefined, after: 1 },
      { table: 'initiatives', before: 12, after: undefined },
      { table: 'people', before: 40, after: 39 },
    ]);
  });
});

describe('countRows', () => {
  let db: TemporaryDatabase;
  beforeAll(async () => {
    db = await createTemporaryDatabase('row_counts');
  });
  afterAll(() => db.drop());

  it('counts every table in schema public exactly', async () => {
    await db.pool.query(`
      CREATE TABLE teams (id int);
      CREATE TABLE "Mixed Case" (id int);
      INSERT INTO teams SELECT generate_series(1, 3);`);
    expect(await countRows(db.pool)).toEqual({ 'Mixed Case': 0, teams: 3 });
  });
});

describe('restore drill', () => {
  it('dumps, destroys, restores, verifies every row count and cleans up after itself', async () => {
    const database = `restore_drill_${randomSuffix()}`;
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', script, '--database', database], {
      cwd: kataRoot,
    });

    expect(stdout).toContain('Seeded: 5 tables, 1096 rows');
    expect(stdout).toContain(`Destroy: DROP DATABASE ${database}`);
    expect(stdout).toContain('Restore verified: every table has the same row count.');

    const { rows } = await withClient(adminConnectionString, (admin) =>
      admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]),
    );
    expect(rows).toHaveLength(0);
  });
});
