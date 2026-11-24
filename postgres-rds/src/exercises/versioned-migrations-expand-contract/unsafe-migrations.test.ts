import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTemporaryDatabase, sqlStateOf, type Queryable, type TemporaryDatabase } from '../../lib/database';
import * as appV1 from './app-v1';
import { backfillDisplayName } from './backfill-display-name';
import { dbmate, readMigrations, upSection, type Migration } from './migrations';

const problem = (file: string) => upSection(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));

let migrations: Migration[];
const migration = (name: string) => {
  const found = migrations.find(({ file }) => file.endsWith(`_${name}.sql`));
  if (!found) throw new Error(`No migration named ${name}`);
  return found;
};

const databases: TemporaryDatabase[] = [];
/** A fresh database with the first `count` migrations and 500 people that existed before the expand step. */
async function databaseAtStep(count: number): Promise<TemporaryDatabase> {
  const db = await createTemporaryDatabase('unsafe_migrations');
  databases.push(db);
  await dbmate(db.connectionString, 'up', migrations.slice(0, Math.min(count, 2)));
  await db.pool.query(
    `INSERT INTO people (full_name, email)
     SELECT 'Person ' || n, 'existing-' || n || '@example.com' FROM generate_series(1, 500) AS n`,
  );
  if (count >= 3) {
    await dbmate(db.connectionString, 'up', migrations.slice(0, 3));
    await backfillDisplayName(db.pool);
    await dbmate(db.connectionString, 'up', migrations.slice(0, count));
  }
  return db;
}

/** Polls until the backend `pid` is waiting for a lock: the DDL is now queued, not running. */
async function waitUntilWaitingForLock(db: Queryable, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await sleep(25);
  }
  throw new Error(`Backend ${pid} never waited for a lock`);
}

/**
 * Reproduces a deploy on a busy table: a transaction that wrote to `people` is still open (a long request,
 * a batch job), the index migration starts, and then the application tries to insert with a 300 ms
 * lock_timeout. Returns the SQLSTATE of that insert while the migration is still waiting.
 */
async function appInsertDuringIndexBuild(db: TemporaryDatabase, indexSql: string): Promise<string> {
  const clients: PoolClient[] = await Promise.all([db.pool.connect(), db.pool.connect(), db.pool.connect()]);
  const [openTransaction, migrator, app] = clients as [PoolClient, PoolClient, PoolClient];
  let build: Promise<unknown> = Promise.resolve();
  try {
    await openTransaction.query('BEGIN');
    await appV1.renamePerson(openTransaction, '1', 'Renamed inside an open transaction');

    const { rows } = await migrator.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    build = migrator.query(indexSql);
    await waitUntilWaitingForLock(db.pool, rows[0]?.pid ?? 0);

    await app.query(`SET lock_timeout = '300ms'`);
    return await sqlStateOf(appV1.addPerson(app, 'Arrived during the deploy', `during-${Date.now()}@example.com`));
  } finally {
    await openTransaction.query('COMMIT');
    await build;
    for (const client of clients) client.release();
  }
}

beforeAll(async () => {
  migrations = await readMigrations();
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

describe('renaming a column in place', () => {
  it('breaks app v1, still running, with 42703 (undefined_column)', async () => {
    const db = await databaseAtStep(1);
    await db.pool.query(problem('rename-column.problem.sql'));
    expect(await sqlStateOf(appV1.findPerson(db.pool, '1'))).toBe('42703');
    expect(await sqlStateOf(appV1.addPerson(db.pool, 'Ada', 'ada@example.com'))).toBe('42703');
  });
});

describe('building an index on a busy table', () => {
  it('a plain CREATE INDEX queues behind the open transaction, and app writes queue behind it (55P03)', async () => {
    const db = await databaseAtStep(6);
    expect(await appInsertDuringIndexBuild(db, problem('create-index.problem.sql'))).toBe('55P03');
  });

  it('CREATE INDEX CONCURRENTLY waits too, but app writes keep going meanwhile', async () => {
    const db = await databaseAtStep(6);
    const concurrently = upSection(migration('index_display_name_concurrently').sql);
    expect(await appInsertDuringIndexBuild(db, concurrently)).toBe('none');
    const { rows } = await db.pool.query(
      `SELECT indisvalid FROM pg_index WHERE indexrelid = 'people_display_name_idx'::regclass`,
    );
    expect(rows).toEqual([{ indisvalid: true }]);
  });

  it('CONCURRENTLY fails inside a transaction, which is why its migration says transaction:false (25001)', async () => {
    const db = await databaseAtStep(6);
    const index = migration('index_display_name_concurrently');
    const inTransaction = { ...index, sql: index.sql.replaceAll(' transaction:false', '') };
    await expect(dbmate(db.connectionString, 'up', [...migrations.slice(0, 6), inTransaction])).rejects.toThrow(
      /cannot run inside a transaction block/,
    );
  });
});

describe('making a column required', () => {
  it('ADD COLUMN … NOT NULL in one step fails on a table that already has rows (23502)', async () => {
    const db = await databaseAtStep(1);
    expect(await sqlStateOf(db.pool.query(problem('add-not-null.problem.sql')))).toBe('23502');
  });

  /** Runs a migration's up section in a transaction and returns the DEBUG messages Postgres sent. */
  async function debugMessages(db: TemporaryDatabase, sql: string): Promise<string[]> {
    const client = await db.pool.connect();
    const messages: string[] = [];
    client.on('notice', (notice) => messages.push(notice.message ?? ''));
    try {
      await client.query('SET client_min_messages = debug1');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      return messages;
    } finally {
      await client.query('RESET client_min_messages');
      client.release();
    }
  }

  it('SET NOT NULL without a validated CHECK scans the whole table under an ACCESS EXCLUSIVE lock', async () => {
    const db = await databaseAtStep(3);
    const messages = await debugMessages(db, 'ALTER TABLE people ALTER COLUMN display_name SET NOT NULL');
    expect(messages).toContain('verifying table "people"');
  });

  it('SET NOT NULL after the validated CHECK skips the scan', async () => {
    const db = await databaseAtStep(5);
    const messages = await debugMessages(db, upSection(migration('set_display_name_not_null').sql));
    expect(messages).toContain(
      'existing constraints on column "people.display_name" are sufficient to prove that it does not contain nulls',
    );
    expect(messages).not.toContain('verifying table "people"');
  });
});
