import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveBinary } from 'dbmate';

const execFileAsync = promisify(execFile);

export const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url));

export interface Migration {
  file: string;
  sql: string;
}

/** The migrations in the order dbmate applies them: by the numeric version at the start of the name. */
export async function readMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  return Promise.all(files.map(async (file) => ({ file, sql: await readFile(join(migrationsDir, file), 'utf8') })));
}

/** dbmate's Postgres driver requires TLS unless the URL says otherwise; the local container has none. */
export function dbmateUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

/**
 * Runs a dbmate command (`up`, `rollback`, `status`) with exactly `migrations` in its migrations directory,
 * which is how a test "deploys release N": the first N files, as that release would ship them.
 * `--no-dump-schema` stops dbmate from calling a local `pg_dump` after each run.
 */
export async function dbmate(connectionString: string, command: string, migrations: Migration[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmate-'));
  try {
    await Promise.all(migrations.map(({ file, sql }) => writeFile(join(dir, file), sql)));
    const args = ['--url', dbmateUrl(connectionString), '--migrations-dir', dir, '--no-dump-schema', command];
    const { stdout } = await execFileAsync(resolveBinary(), args);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The SQL of the `-- migrate:up` section, to run one migration step with a client of our own. */
export function upSection(migration: string): string {
  const lines = migration.split('\n');
  const start = lines.findIndex((line) => line.startsWith('-- migrate:up'));
  if (start === -1) throw new Error('The migration has no "-- migrate:up" section');
  const end = lines.findIndex((line, index) => index > start && line.startsWith('-- migrate:down'));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}
