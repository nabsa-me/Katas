import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTemporaryDatabase, sqlStateOf, type Queryable, type TemporaryDatabase } from '../../lib/database';
import * as appV1 from './app-v1';
import * as appV2 from './app-v2';
import { backfillDisplayName } from './backfill-display-name';
import { dbmate, readMigrations, type Migration } from './migrations';

let migrations: Migration[];
let emails = 0;
const nextEmail = () => `person-${++emails}@example.com`;

/** Deploys the release that ships the first `count` migrations. */
const deploy = (db: TemporaryDatabase, count: number) => dbmate(db.connectionString, 'up', migrations.slice(0, count));

/** What app v1 does all day: add a person, rename them, read them back. */
async function appV1Works(db: Queryable): Promise<void> {
  const id = await appV1.addPerson(db, 'Núria Camps', nextEmail());
  await appV1.renamePerson(db, id, 'Núria Camps Puig');
  expect(await appV1.findPerson(db, id)).toMatchObject({ fullName: 'Núria Camps Puig' });
}

/** The same for app v2, plus its new search by name. */
async function appV2Works(db: Queryable): Promise<void> {
  const id = await appV2.addPerson(db, 'Pau Serra', nextEmail());
  await appV2.renamePerson(db, id, 'Pau Serra Vidal');
  expect(await appV2.findPerson(db, id)).toMatchObject({ displayName: 'Pau Serra Vidal' });
  expect((await appV2.findByDisplayName(db, 'Pau Serra Vidal')).map((person) => person.id)).toContain(id);
}

beforeAll(async () => {
  migrations = await readMigrations();
});

describe('renaming people.full_name to display_name, one migration per release', () => {
  let db: TemporaryDatabase;
  beforeAll(async () => {
    db = await createTemporaryDatabase('expand_contract');
  });
  afterAll(() => db.drop());

  it('ships the steps in this order', () => {
    expect(migrations.map(({ file }) => file.replace(/^\d+_|\.sql$/g, ''))).toEqual([
      'create_people',
      'add_display_name',
      'sync_display_name_with_full_name',
      'check_display_name_not_null',
      'validate_display_name_not_null',
      'set_display_name_not_null',
      'index_display_name_concurrently',
      'drop_full_name',
    ]);
  });

  it('create_people: app v1 works, and production already holds 2,500 people', async () => {
    await deploy(db, 1);
    await db.pool.query(
      `INSERT INTO people (full_name, email)
       SELECT 'Person ' || n, 'existing-' || n || '@example.com' FROM generate_series(1, 2500) AS n`,
    );
    await appV1Works(db.pool);
  });

  it('add_display_name (expand): app v1 keeps working', async () => {
    await deploy(db, 2);
    await appV1Works(db.pool);
  });

  it('sync_display_name_with_full_name: v1 writes fill both columns, and the backfill copies the rest in batches', async () => {
    await deploy(db, 3);
    await appV1Works(db.pool);
    const { rows } = await db.pool.query(`SELECT display_name FROM people ORDER BY id DESC LIMIT 1`);
    expect(rows).toEqual([{ display_name: 'Núria Camps Puig' }]);

    // 2,500 existing rows plus the two written by v1 before the trigger existed.
    expect(await backfillDisplayName(db.pool, 1_000)).toEqual({ batches: 3, updated: 2_502 });
    // Safe to run again: it skips what is already copied.
    expect(await backfillDisplayName(db.pool, 1_000)).toEqual({ batches: 3, updated: 0 });
    const pending = await db.pool.query(`SELECT 1 FROM people WHERE display_name IS DISTINCT FROM full_name`);
    expect(pending.rows).toHaveLength(0);
  });

  it('check_display_name_not_null (NOT VALID): app v1 keeps working', async () => {
    await deploy(db, 4);
    await appV1Works(db.pool);
  });

  it('validate_display_name_not_null: app v1 keeps working', async () => {
    await deploy(db, 5);
    await appV1Works(db.pool);
  });

  it('set_display_name_not_null: v2 ships next to v1, and each version sees what the other writes', async () => {
    await deploy(db, 6);
    await appV1Works(db.pool);
    await appV2Works(db.pool);

    const writtenByV1 = await appV1.addPerson(db.pool, 'Laia Font', nextEmail());
    expect(await appV2.findPerson(db.pool, writtenByV1)).toMatchObject({ displayName: 'Laia Font' });
    await appV2.renamePerson(db.pool, writtenByV1, 'Laia Font Roig');
    expect(await appV1.findPerson(db.pool, writtenByV1)).toMatchObject({ fullName: 'Laia Font Roig' });
  });

  it('index_display_name_concurrently: both versions keep working and the index is valid', async () => {
    await deploy(db, 7);
    await appV1Works(db.pool);
    await appV2Works(db.pool);
    const { rows } = await db.pool.query(
      `SELECT indisvalid FROM pg_index WHERE indexrelid = 'people_display_name_idx'::regclass`,
    );
    expect(rows).toEqual([{ indisvalid: true }]);
  });

  it('drop_full_name (contract), once v1 is retired: v2 keeps working, v1 would fail with 42703', async () => {
    await deploy(db, 8);
    await appV2Works(db.pool);
    expect(await sqlStateOf(appV1.findPerson(db.pool, '1'))).toBe('42703');
    expect(await sqlStateOf(appV1.addPerson(db.pool, 'Too Late', nextEmail()))).toBe('42703');
  });
});

describe('rolling back', () => {
  let db: TemporaryDatabase;
  beforeAll(async () => {
    db = await createTemporaryDatabase('expand_contract_rollback');
  });
  afterAll(() => db.drop());

  it('undoes every expand step in reverse order, and the contract step refuses to', async () => {
    await deploy(db, 8);
    await expect(dbmate(db.connectionString, 'rollback', migrations)).rejects.toThrow(/cannot be rolled back/);

    // A database that stopped before the contract step rolls all the way back.
    await db.pool.query('DROP TABLE people, schema_migrations');
    await deploy(db, 7);
    for (let step = 7; step > 0; step--) await dbmate(db.connectionString, 'rollback', migrations);
    const { rows } = await db.pool.query(`SELECT to_regclass('people') AS people`);
    expect(rows).toEqual([{ people: null }]);
  });
});
