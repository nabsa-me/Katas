#!/usr/bin/env node
// @ts-check
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Lists the database migrations of a repository that the target environment has not applied yet. No dependencies,
 * so the skill can run it in any project with Node:
 *   node check-pending-migrations.mjs --dir db/migrations --applied applied-versions.txt
 * `--applied` is a file with one applied version per line, for example the output of
 * `psql -Atc "SELECT version FROM schema_migrations"` against the target database (dbmate's table).
 * Exit codes: 0 nothing pending, 1 pending migrations listed, 2 the check could not run.
 */

/** A dbmate migration file: the version (digits, usually a timestamp), an underscore, a name and `.sql`. */
const MIGRATION_FILE = /^(\d+)_[\w.-]+\.sql$/;

/** @typedef {{ version: string, file: string, outOfOrder: boolean }} PendingMigration */

/**
 * Compares two numeric versions of any length.
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const difference = BigInt(a) - BigInt(b);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/**
 * The migrations in `files` whose version is not in `appliedVersions`, oldest first. A pending migration older than
 * the newest applied one is flagged `outOfOrder`: migration tools differ (some apply it, some refuse, some ignore it
 * unless configured), and it was written against an older schema than the one in production.
 * @param {readonly string[]} files names in the migrations directory (other files are ignored)
 * @param {readonly string[]} appliedVersions lines of the applied list (blank lines and `#` comments are ignored)
 * @returns {PendingMigration[]}
 */
export function findPendingMigrations(files, appliedVersions) {
  const applied = new Set(appliedVersions.map((line) => line.trim()).filter((line) => /^\d+$/.test(line)));
  const newestApplied = [...applied].sort(compareVersions).at(-1);
  return files
    .flatMap((file) => {
      const version = MIGRATION_FILE.exec(file)?.[1];
      return version === undefined || applied.has(version) ? [] : [{ version, file }];
    })
    .sort((a, b) => compareVersions(a.version, b.version))
    .map((migration) => ({
      ...migration,
      outOfOrder: newestApplied !== undefined && compareVersions(migration.version, newestApplied) < 0,
    }));
}

/**
 * The text the CLI prints: one line per pending migration, with the out-of-order warning where it applies.
 * @param {string} dir
 * @param {readonly PendingMigration[]} pending
 */
export function formatReport(dir, pending) {
  if (pending.length === 0) return `No pending migrations in ${dir}.`;
  const lines = pending.map(
    (migration) =>
      `  ${migration.file}${migration.outOfOrder ? '  (OUT OF ORDER: older than the newest applied migration)' : ''}`,
  );
  return [`${pending.length} pending migration(s) in ${dir}, not applied in the target environment:`, ...lines].join(
    '\n',
  );
}

/**
 * @param {string[]} args
 * @returns {number} the exit code
 */
export function main(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: { dir: { type: 'string', default: 'db/migrations' }, applied: { type: 'string' } },
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (!values.applied) {
    console.error('Usage: check-pending-migrations.mjs [--dir db/migrations] --applied <file with applied versions>');
    return 2;
  }
  if (!existsSync(values.dir) || !existsSync(values.applied)) {
    console.error(`Not found: ${existsSync(values.dir) ? values.applied : values.dir}`);
    return 2;
  }
  const appliedVersions = readFileSync(values.applied, 'utf8').split(/\r?\n/);
  const pending = findPendingMigrations(readdirSync(values.dir), appliedVersions);
  console.log(formatReport(values.dir, pending));
  return pending.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
