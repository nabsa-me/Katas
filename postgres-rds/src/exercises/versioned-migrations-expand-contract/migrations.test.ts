import { describe, expect, it } from 'vitest';
import { dbmateUrl, readMigrations, upSection } from './migrations';

describe('upSection', () => {
  it('returns the SQL between "-- migrate:up" and "-- migrate:down", without the options', () => {
    const migration = [
      '-- migrate:up transaction:false',
      'CREATE INDEX CONCURRENTLY i ON t (c);',
      '',
      '-- migrate:down transaction:false',
      'DROP INDEX CONCURRENTLY i;',
    ].join('\n');
    expect(upSection(migration)).toBe('CREATE INDEX CONCURRENTLY i ON t (c);');
  });

  it('returns everything after "-- migrate:up" when there is no down section', () => {
    expect(upSection('-- migrate:up\nSELECT 1;\nSELECT 2;\n')).toBe('SELECT 1;\nSELECT 2;');
  });

  it('rejects a file without an up section', () => {
    expect(() => upSection('SELECT 1;')).toThrow(/migrate:up/);
  });
});

describe('dbmateUrl', () => {
  it('disables TLS for the local container, keeping the rest of the URL', () => {
    expect(dbmateUrl('postgres://u:p@localhost:5807/app')).toBe('postgres://u:p@localhost:5807/app?sslmode=disable');
  });
});

describe('readMigrations', () => {
  it('reads every migration with an up and a down section, in version order', async () => {
    const migrations = await readMigrations();
    expect(migrations).toHaveLength(8);
    expect(migrations.map(({ file }) => file)).toEqual(migrations.map(({ file }) => file).sort());
    for (const { sql } of migrations) {
      expect(sql).toMatch(/^-- migrate:up/m);
      expect(sql).toMatch(/^-- migrate:down/m);
    }
  });
});
