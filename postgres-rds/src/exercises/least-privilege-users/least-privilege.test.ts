import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, escapeIdentifier, escapeLiteral } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminConnectionString,
  connectionStringFor,
  createTemporaryDatabase,
  randomSuffix,
  sqlStateOf,
  withClient,
  type TemporaryDatabase,
} from '../../lib/database';
import { createAppPool as createMasterPool } from './app-pool.problem';
import { createAppPool, excessPrivileges, type UserPrivileges } from './app-pool';

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

/**
 * Roles are cluster-wide, unlike tables. Every role name in the SQL files gets this file's suffix, so
 * parallel runs never share (or drop) each other's roles.
 */
const suffix = randomSuffix();
const ROLES = ['migrator', 'app_rw', 'app_ro', 'reporting', 'deployer', 'issues_api', 'issues_viewer', 'bi_reader'];
const LOGIN_USERS = ['deployer', 'issues_api', 'issues_viewer', 'bi_reader', 'outsider'];
const role = (name: string) => `${name}_${suffix}`;
const withSuffix = (sql: string) => sql.replace(new RegExp(`\\b(${ROLES.join('|')})\\b`, 'g'), `$1_${suffix}`);

let db: TemporaryDatabase;
const passwords = new Map(LOGIN_USERS.map((user) => [user, randomBytes(12).toString('hex')]));

/** Connection string for one of the login users, on the test database. */
function urlFor(user: string): string {
  const url = new URL(connectionStringFor(db.name));
  url.username = role(user);
  url.password = passwords.get(user) ?? '';
  return url.toString();
}

const asUser = <T>(user: string, work: (client: Client) => Promise<T>) => withClient(urlFor(user), work);

beforeAll(async () => {
  db = await createTemporaryDatabase('least_privilege');
  await db.pool.query(withSuffix(read('roles.sql')));
  // A login user that belongs to no group, to show what PUBLIC is left with.
  await db.pool.query(`CREATE ROLE ${escapeIdentifier(role('outsider'))} LOGIN`);
  for (const [user, password] of passwords) {
    await db.pool.query(`ALTER ROLE ${escapeIdentifier(role(user))} PASSWORD ${escapeLiteral(password)}`);
  }
  await asUser('deployer', (client) => client.query(withSuffix(read('app-schema.sql'))));
  await asUser('issues_api', (client) =>
    client.query(`
      INSERT INTO teams (name) VALUES ('Platform');
      INSERT INTO jira_issues (team_id, issue_key, status)
      SELECT id, key, status FROM teams,
        (VALUES ('PLAT-1', 'todo'), ('PLAT-2', 'in_progress'), ('PLAT-3', 'done')) AS issues (key, status);`),
  );
});

afterAll(async () => {
  // The database first: roles cannot be dropped while they own objects or hold privileges in it.
  await db.drop();
  const names = [...ROLES, 'outsider'].map((name) => escapeIdentifier(role(name)));
  await withClient(adminConnectionString, (admin) => admin.query(`DROP ROLE IF EXISTS ${names.join(', ')}`));
});

describe('application connected as the master user (problem)', () => {
  it('can drop tables and create superusers: one bug or injected statement away from losing everything', async () => {
    const pool = createMasterPool(connectionStringFor(db.name));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await sqlStateOf(client.query('DROP TABLE jira_issues CASCADE'))).toBe('none');
      expect(await sqlStateOf(client.query(`CREATE ROLE ${escapeIdentifier(role('intruder'))} SUPERUSER`))).toBe(
        'none',
      );
    } finally {
      await client.query('ROLLBACK'); // DDL and roles are transactional in Postgres: nothing happened.
      client.release();
      await pool.end();
    }
  });
});

describe('least-privilege roles (solution)', () => {
  it('the application refuses to start with the master user or the deployer, and starts with its own user', async () => {
    await expect(createAppPool(connectionStringFor(db.name))).rejects.toThrow(/user "postgres" is a superuser/);
    await expect(createAppPool(urlFor('deployer'))).rejects.toThrow(
      new RegExp(`user "${role('migrator')}" owns tables, so it can alter or drop them, can create objects`),
    );
    const pool = await createAppPool(urlFor('issues_api'));
    await pool.end();
  });

  it('app_ro reads rows and cannot write them (42501)', async () => {
    await asUser('issues_viewer', async (client) => {
      expect((await client.query('SELECT count(*)::int AS issues FROM jira_issues')).rows).toEqual([{ issues: 3 }]);
      expect(await sqlStateOf(client.query(`INSERT INTO teams (name) VALUES ('Payments')`))).toBe('42501');
      expect(await sqlStateOf(client.query(`UPDATE jira_issues SET status = 'done'`))).toBe('42501');
      expect(await sqlStateOf(client.query('DELETE FROM jira_issues'))).toBe('42501');
    });
  });

  it('app_rw reads and writes rows and cannot change the schema (42501)', async () => {
    await asUser('issues_api', async (client) => {
      expect(await sqlStateOf(client.query(`INSERT INTO teams (name) VALUES ('Payments')`))).toBe('none');
      expect(await sqlStateOf(client.query(`UPDATE jira_issues SET status = 'done' WHERE issue_key = 'PLAT-1'`))).toBe(
        'none',
      );
      expect(await sqlStateOf(client.query(`DELETE FROM teams WHERE name = 'Payments'`))).toBe('none');

      const ddl = [
        'CREATE TABLE shadow_copy (id int)',
        'ALTER TABLE jira_issues ADD COLUMN notes text',
        'DROP TABLE jira_issues',
        'TRUNCATE jira_issues',
        'CREATE SCHEMA scratch',
      ];
      for (const sql of ddl) expect(await sqlStateOf(client.query(sql)), sql).toBe('42501');
    });
  });

  it('tables created later by the deployer belong to migrator and are usable at once (default privileges)', async () => {
    await asUser('deployer', (client) =>
      client.query('CREATE TABLE initiatives (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL)'),
    );
    const owner = await db.pool.query(`SELECT tableowner FROM pg_tables WHERE tablename = 'initiatives'`);
    expect(owner.rows).toEqual([{ tableowner: role('migrator') }]);

    await asUser('issues_api', async (client) => {
      expect(await sqlStateOf(client.query(`INSERT INTO initiatives (name) VALUES ('Billing')`))).toBe('none');
    });
    await asUser('issues_viewer', async (client) => {
      expect((await client.query('SELECT name FROM initiatives')).rows).toEqual([{ name: 'Billing' }]);
      expect(await sqlStateOf(client.query(`INSERT INTO initiatives (name) VALUES ('Nope')`))).toBe('42501');
    });
  });

  it('reporting reads the report views, never the tables behind them', async () => {
    await asUser('bi_reader', async (client) => {
      const report = await client.query('SELECT team, open_issues FROM reports.open_issues_per_team');
      expect(report.rows).toEqual([{ team: 'Platform', open_issues: 1 }]);
      expect(await sqlStateOf(client.query('SELECT * FROM public.jira_issues'))).toBe('42501');
    });
  });

  it('a login user in no group cannot even connect (42501)', async () => {
    const client = new Client({ connectionString: urlFor('outsider') });
    expect(await sqlStateOf(client.connect())).toBe('42501');
  });
});

describe('excessPrivileges', () => {
  const applicationUser: UserPrivileges = {
    user: 'issues_api',
    superuser: false,
    rdsSuperuser: false,
    createRole: false,
    createDatabase: false,
    bypassRowLevelSecurity: false,
    ownsTables: false,
    canCreateInPublic: false,
  };

  it('accepts a user that can only read and write rows', () => {
    expect(excessPrivileges(applicationUser)).toEqual([]);
  });

  it('names every excess privilege of an RDS master user', () => {
    const rdsMaster = {
      ...applicationUser,
      user: 'postgres',
      rdsSuperuser: true,
      createRole: true,
      createDatabase: true,
    };
    expect(excessPrivileges(rdsMaster)).toEqual([
      'is a member of rds_superuser (the RDS master user is)',
      'can create roles',
      'can create databases',
    ]);
  });
});
