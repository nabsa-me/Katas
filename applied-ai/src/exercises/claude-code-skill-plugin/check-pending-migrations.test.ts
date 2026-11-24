import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findPendingMigrations,
  formatReport,
} from './marketplace/plugins/release-tools/skills/release-checklist/scripts/check-pending-migrations.mjs';

const SCRIPT = fileURLToPath(
  new URL(
    './marketplace/plugins/release-tools/skills/release-checklist/scripts/check-pending-migrations.mjs',
    import.meta.url,
  ),
);
const SAMPLE_MIGRATIONS = fileURLToPath(new URL('./sample-service/db/migrations', import.meta.url));
const SAMPLE_APPLIED = fileURLToPath(new URL('./sample-service/applied-versions.txt', import.meta.url));

describe('findPendingMigrations', () => {
  it('returns the migrations whose version is not applied, oldest first', () => {
    const files = ['20261121101500_add_customer_tax_id.sql', '20261101090000_create_invoices.sql'];
    expect(findPendingMigrations(files, [])).toEqual([
      { version: '20261101090000', file: '20261101090000_create_invoices.sql', outOfOrder: false },
      { version: '20261121101500', file: '20261121101500_add_customer_tax_id.sql', outOfOrder: false },
    ]);
  });

  it('ignores files that are not migrations and lines that are not versions', () => {
    const files = ['README.md', '.gitkeep', '20261101090000_notes.txt', '20261101090000_create_invoices.sql'];
    const applied = ['# applied in production', '', '  20261101090000\r', 'not-a-version'];
    expect(findPendingMigrations(files, applied)).toEqual([]);
  });

  it('flags a pending migration older than the newest applied one as out of order', () => {
    const files = ['20261101090000_a.sql', '20261105120000_b.sql', '20261112150000_c.sql', '20261121101500_d.sql'];
    const pending = findPendingMigrations(files, ['20261101090000', '20261112150000']);
    expect(pending.map(({ version, outOfOrder }) => ({ version, outOfOrder }))).toEqual([
      { version: '20261105120000', outOfOrder: true },
      { version: '20261121101500', outOfOrder: false },
    ]);
  });

  it('compares versions as numbers, not as text', () => {
    const pending = findPendingMigrations(['9_second.sql', '10_third.sql', '1_first.sql'], ['1']);
    expect(pending.map((migration) => migration.version)).toEqual(['9', '10']);
  });
});

describe('formatReport', () => {
  it('says so when nothing is pending', () => {
    expect(formatReport('db/migrations', [])).toBe('No pending migrations in db/migrations.');
  });

  it('lists each pending migration and marks the ones out of order', () => {
    const pending = findPendingMigrations(['2_b.sql', '4_d.sql'], ['1', '3']);
    expect(formatReport('db/migrations', pending)).toBe(
      [
        '2 pending migration(s) in db/migrations, not applied in the target environment:',
        '  2_b.sql  (OUT OF ORDER: older than the newest applied migration)',
        '  4_d.sql',
      ].join('\n'),
    );
  });
});

describe('check-pending-migrations CLI', () => {
  let tempDir: string | undefined;
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('exits 1 and lists the pending migrations of the sample service', () => {
    const result = run('--dir', SAMPLE_MIGRATIONS, '--applied', SAMPLE_APPLIED);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('2 pending migration(s)');
    expect(result.stdout).toContain('20261105120000_add_invoice_due_date.sql  (OUT OF ORDER');
    expect(result.stdout).toContain('20261121101500_add_customer_tax_id.sql');
  });

  it('exits 0 when every migration is applied', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'applied-'));
    const applied = join(tempDir, 'applied.txt');
    writeFileSync(applied, '20261101090000\n20261105120000\n20261112150000\n20261121101500\n');
    const result = run('--dir', SAMPLE_MIGRATIONS, '--applied', applied);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`No pending migrations in ${SAMPLE_MIGRATIONS}.`);
  });

  it.each([
    ['without the applied list', ['--dir', SAMPLE_MIGRATIONS], /Usage/],
    [
      'with a missing directory',
      ['--dir', 'does/not/exist', '--applied', SAMPLE_APPLIED],
      /Not found: does\/not\/exist/,
    ],
    ['with an unknown option', ['--applied', SAMPLE_APPLIED, '--env', 'prod'], /Unknown option '--env'/],
  ])('exits 2 %s, so the skill reports that the check could not run', (_, args, message) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(message);
  });
});
