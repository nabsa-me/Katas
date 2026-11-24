import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTemporaryDatabase, sqlStateOf, type Queryable, type TemporaryDatabase } from '../../lib/database';

const problemSchema = readFileSync(new URL('./schema.problem.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

let counter = 0;
/** Unique values per call, so tests sharing a database never collide on UNIQUE constraints. */
const unique = (base: string) => `${base}-${++counter}`;

async function insertId(db: Queryable, sql: string, values: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`${sql} RETURNING id`, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('The insert returned no id');
  return id;
}

const insertTeam = (db: Queryable, slug = unique('team')) =>
  insertId(db, 'INSERT INTO teams (slug, name) VALUES ($1, $2)', [slug, `Team ${slug}`]);

const insertPerson = (db: Queryable, email = `${unique('person')}@example.com`) =>
  insertId(db, 'INSERT INTO people (email, display_name) VALUES ($1, $2)', [email, 'Ada Serra']);

const insertMembership = (db: Queryable, teamId: string, personId: string, from: string, to: string | null) =>
  insertId(db, 'INSERT INTO team_memberships (team_id, person_id, valid_from, valid_to) VALUES ($1, $2, $3, $4)', [
    teamId,
    personId,
    from,
    to,
  ]);

const insertInitiative = (db: Queryable, teamId: string) =>
  insertId(db, 'INSERT INTO initiatives (owner_team_id, name) VALUES ($1, $2)', [teamId, unique('Initiative')]);

const insertIssue = (db: Queryable, fields: { assigneeId?: string; status?: string; key?: string } = {}) =>
  insertId(
    db,
    `INSERT INTO jira_issues (issue_key, assignee_id, summary, status, jira_updated_at)
     VALUES ($1, $2, 'Rotate credentials', $3, now())`,
    [fields.key ?? `PLAT-${++counter}`, fields.assigneeId ?? null, fields.status ?? 'todo'],
  );

describe('NoSQL-style schema (problem)', () => {
  let db: TemporaryDatabase;
  beforeAll(async () => {
    db = await createTemporaryDatabase('schema_problem');
    await db.pool.query(problemSchema);
  });
  afterAll(() => db.drop());

  it('accepts every invalid row: the database cannot tell good data from bad', async () => {
    const invalidWrites = [
      // A person without an email, and two people with the same email in different case.
      `INSERT INTO people VALUES ('p1', '{"displayName": "Ada"}')`,
      `INSERT INTO people VALUES ('p2', '{"email": "pau@example.com"}'), ('p3', '{"email": "PAU@example.com"}')`,
      // Two rows with the same id: there is no primary key.
      `INSERT INTO teams VALUES ('t1', '{"slug": "platform"}'), ('t1', '{"slug": "payments"}')`,
      // A membership to a team that does not exist, and two overlapping ones.
      `INSERT INTO people VALUES ('p4', '{"memberships": [{"teamId": "nope", "from": "2026-01-01"},
        {"teamId": "t1", "from": "2026-01-01"}, {"teamId": "t1", "from": "2026-02-01"}]}')`,
      // A status nobody handles, negative story points and a dangling assignee.
      `INSERT INTO jira_issues VALUES ('i1', '{"key": "plat 1", "status": "banana", "storyPoints": -3,
        "assigneeId": "ghost"}')`,
      // Deleting a team leaves its initiatives pointing nowhere.
      `INSERT INTO initiatives VALUES ('n1', '{"ownerTeamId": "t1", "name": "Billing"}')`,
      `DELETE FROM teams WHERE id = 't1'`,
    ];
    for (const sql of invalidWrites) {
      expect(await sqlStateOf(db.pool.query(sql)), sql).toBe('none');
    }
    const { rows } = await db.pool.query(`SELECT * FROM initiatives WHERE doc->>'ownerTeamId' = 't1'`);
    expect(rows).toHaveLength(1);
  });
});

describe('normalized schema (solution)', () => {
  let db: TemporaryDatabase;
  beforeAll(async () => {
    db = await createTemporaryDatabase('schema_design');
    await db.pool.query(schema);
  });
  afterAll(() => db.drop());

  it('rejects missing required values with NOT NULL (23502)', async () => {
    expect(await sqlStateOf(db.pool.query(`INSERT INTO people (display_name) VALUES ('Ada')`))).toBe('23502');
  });

  it('rejects a duplicate email in another case through the unique index on lower(email) (23505)', async () => {
    const email = `${unique('dup')}@example.com`;
    await insertPerson(db.pool, email);
    expect(await sqlStateOf(insertPerson(db.pool, email.toUpperCase()))).toBe('23505');
  });

  it('rejects references to rows that do not exist (23503)', async () => {
    const personId = await insertPerson(db.pool);
    expect(await sqlStateOf(insertMembership(db.pool, '999999', personId, '2026-01-01', null))).toBe('23503');
  });

  it('rejects invalid values with CHECK constraints (23514)', async () => {
    const teamId = await insertTeam(db.pool);
    const personId = await insertPerson(db.pool);
    const checks = [
      () => insertIssue(db.pool, { status: 'banana' }),
      () => insertIssue(db.pool, { key: 'plat 1' }),
      () => insertMembership(db.pool, teamId, personId, '2026-03-01', '2026-02-01'),
      () => insertPerson(db.pool, 'not-an-email'),
      () =>
        db.pool.query(
          `INSERT INTO jira_issues (issue_key, summary, status, custom_fields, jira_updated_at)
           VALUES ('PLAT-77', 'Array instead of object', 'todo', '[1, 2]', now())`,
        ),
    ];
    for (const check of checks) expect(await sqlStateOf(check())).toBe('23514');
  });

  it('rejects overlapping memberships of the same person in the same team (23P01)', async () => {
    const teamId = await insertTeam(db.pool);
    const personId = await insertPerson(db.pool);
    await insertMembership(db.pool, teamId, personId, '2026-01-01', null);
    // The end date is exclusive, so a membership ending the day the next one starts does not overlap.
    expect(await sqlStateOf(insertMembership(db.pool, teamId, personId, '2025-06-01', '2026-01-01'))).toBe('none');
    expect(await sqlStateOf(insertMembership(db.pool, teamId, personId, '2026-03-01', '2026-04-01'))).toBe('23P01');
    // Another team over the same dates is fine.
    const otherTeamId = await insertTeam(db.pool);
    expect(await sqlStateOf(insertMembership(db.pool, otherTeamId, personId, '2026-03-01', null))).toBe('none');
  });

  it('applies the ON DELETE rule chosen for each relationship', async () => {
    const teamId = await insertTeam(db.pool);
    const personId = await insertPerson(db.pool);
    await insertMembership(db.pool, teamId, personId, '2026-01-01', null);
    const issueId = await insertIssue(db.pool, { assigneeId: personId });
    const initiativeId = await insertInitiative(db.pool, teamId);

    // RESTRICT: a team that owns an initiative cannot be deleted.
    expect(await sqlStateOf(db.pool.query('DELETE FROM teams WHERE id = $1', [teamId]))).toBe('23503');

    // SET NULL: deleting the person unassigns the issue. CASCADE: their memberships go with them.
    await db.pool.query('DELETE FROM people WHERE id = $1', [personId]);
    const issue = await db.pool.query('SELECT assignee_id FROM jira_issues WHERE id = $1', [issueId]);
    expect(issue.rows).toEqual([{ assignee_id: null }]);
    const memberships = await db.pool.query('SELECT 1 FROM team_memberships WHERE person_id = $1', [personId]);
    expect(memberships.rows).toHaveLength(0);

    await db.pool.query('DELETE FROM initiatives WHERE id = $1', [initiativeId]);
    expect(await sqlStateOf(db.pool.query('DELETE FROM teams WHERE id = $1', [teamId]))).toBe('none');
  });

  it('keeps updated_at current with a trigger, whatever the UPDATE sets', async () => {
    const teamId = await insertTeam(db.pool);
    await db.pool.query(`UPDATE teams SET name = 'Renamed', updated_at = '2000-01-01' WHERE id = $1`, [teamId]);
    const { rows } = await db.pool.query<{ fresh: boolean }>(
      'SELECT updated_at > created_at AS fresh FROM teams WHERE id = $1',
      [teamId],
    );
    expect(rows).toEqual([{ fresh: true }]);
  });

  it('stores custom fields as JSONB and finds them by containment', async () => {
    await db.pool.query(
      `INSERT INTO jira_issues (issue_key, summary, status, custom_fields, jira_updated_at)
       VALUES ('OPS-1', 'Disk full', 'todo', '{"severity": "high", "component": "db"}', now())`,
    );
    const { rows } = await db.pool.query(`SELECT issue_key FROM jira_issues WHERE custom_fields @> $1`, [
      { severity: 'high' },
    ]);
    expect(rows).toEqual([{ issue_key: 'OPS-1' }]);
  });

  it('has an index starting with every foreign key column, so deletes and joins do not scan', async () => {
    const unindexedForeignKeys = `
      SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
        )`;
    expect((await db.pool.query(unindexedForeignKeys)).rows).toEqual([]);

    // The same query does catch a foreign key without an index.
    await db.pool.query('CREATE TABLE audit_notes (team_id bigint REFERENCES teams (id))');
    expect((await db.pool.query(unindexedForeignKeys)).rows).toEqual([
      { table_name: 'audit_notes', column_name: 'team_id' },
    ]);
    await db.pool.query('DROP TABLE audit_notes');
  });
});
