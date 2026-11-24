import { describe, expect, it } from 'vitest';
import {
  adminConnectionString,
  connectionStringFor,
  createTemporaryDatabase,
  randomSuffix,
  sqlStateOf,
  withClient,
} from './database';

async function databaseExists(name: string): Promise<boolean> {
  const { rows } = await withClient(adminConnectionString, (admin) =>
    admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]),
  );
  return rows.length === 1;
}

describe('temporary databases', () => {
  it('creates a database with a random suffix and drops it, even with sessions still open', async () => {
    const db = await createTemporaryDatabase('lib_check');
    expect(db.name).toMatch(/^lib_check_[0-9a-f]{8}$/);
    expect(await databaseExists(db.name)).toBe(true);

    const { rows } = await db.pool.query<{ name: string }>('SELECT current_database() AS name');
    expect(rows[0]?.name).toBe(db.name);

    await db.drop();
    expect(await databaseExists(db.name)).toBe(false);
  });

  it('rejects prefixes that are not plain identifiers', async () => {
    await expect(createTemporaryDatabase('bad-prefix"; DROP')).rejects.toThrow(/Invalid database prefix/);
  });

  it('builds connection strings for another database on the same server', () => {
    expect(connectionStringFor('other', 'postgres://u:p@localhost:5807/postgres')).toBe(
      'postgres://u:p@localhost:5807/other',
    );
  });

  it('generates different suffixes', () => {
    expect(randomSuffix()).not.toBe(randomSuffix());
  });
});

describe('sqlStateOf', () => {
  it('returns the SQLSTATE of a server error, or "none" on success', async () => {
    await withClient(adminConnectionString, async (client) => {
      expect(await sqlStateOf(client.query('SELECT 1'))).toBe('none');
      expect(await sqlStateOf(client.query('SELECT * FROM table_that_does_not_exist'))).toBe('42P01');
    });
  });

  it('rethrows errors that do not come from the server', async () => {
    await expect(sqlStateOf(Promise.reject(new Error('network down')))).rejects.toThrow('network down');
  });
});
