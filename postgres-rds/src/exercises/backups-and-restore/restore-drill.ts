/**
 * `npm run restore-drill`: backup → destroy → restore → verify, against the Postgres in docker-compose.yml.
 * pg_dump and pg_restore run inside the container, so their version always matches the server's.
 * Exits with 1 if any table comes back with a different number of rows.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { escapeIdentifier } from 'pg';
import { adminConnectionString, connectionStringFor, START_POSTGRES_HINT, withClient } from '../../lib/database';
import { compareCounts, countRows, type RowCounts } from './row-counts';

const composeFile = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url));
const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const { values } = parseArgs({ options: { database: { type: 'string', default: 'restore_drill' } } });
const database = values.database;
if (!/^[a-z][a-z0-9_]*$/.test(database)) throw new Error(`Invalid database name: ${database}`);

/** Runs a command inside the compose service, with stdin and stdout available for streaming. */
function inContainer(command: string[]): ChildProcessWithoutNullStreams {
  return spawn('docker', ['compose', '-f', composeFile, 'exec', '-T', 'postgres', ...command]);
}

function exitCode(child: ChildProcessWithoutNullStreams, name: string): Promise<void> {
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}: ${stderr}`))));
  });
}

const admin = (sql: string) => withClient(adminConnectionString, (client) => client.query(sql));
const counts = () => withClient(connectionStringFor(database), countRows);
const seconds = (start: number) => `${((performance.now() - start) / 1000).toFixed(1)} s`;

async function drill(): Promise<boolean> {
  const name = escapeIdentifier(database);
  const dumpFile = join(tmpdir(), `${database}.dump`);
  console.log(`Restore drill on database ${database}\n`);

  await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${name}`);
  try {
    await withClient(connectionStringFor(database), async (client) => {
      await client.query(await read('../schema-design/schema.sql'));
      await client.query(await read('./drill-data.sql'));
    });
    const before: RowCounts = await counts();
    const total = Object.values(before).reduce((sum, count) => sum + count, 0);
    if (total === 0) throw new Error('Nothing to verify: the database is empty');
    console.log(`Seeded: ${Object.keys(before).length} tables, ${total} rows`);

    let start = performance.now();
    const dump = inContainer(['pg_dump', '--username=postgres', '--format=custom', `--dbname=${database}`]);
    await Promise.all([pipeline(dump.stdout, createWriteStream(dumpFile)), exitCode(dump, 'pg_dump')]);
    console.log(
      `Backup:  pg_dump --format=custom → ${dumpFile} (${(await stat(dumpFile)).size} bytes) in ${seconds(start)}`,
    );

    await admin(`DROP DATABASE ${name} WITH (FORCE)`);
    console.log(`Destroy: DROP DATABASE ${database}`);

    start = performance.now();
    await admin(`CREATE DATABASE ${name}`);
    const restore = inContainer(['pg_restore', '--username=postgres', '--exit-on-error', `--dbname=${database}`]);
    await Promise.all([pipeline(createReadStream(dumpFile), restore.stdin), exitCode(restore, 'pg_restore')]);
    console.log(`Restore: pg_restore into a new ${database} in ${seconds(start)} (your local RTO for this size)\n`);

    const after = await counts();
    const mismatches = compareCounts(before, after);
    console.table(Object.fromEntries(Object.keys(before).map((t) => [t, { before: before[t], after: after[t] }])));
    for (const { table, before: expected, after: actual } of mismatches) {
      console.error(`MISMATCH ${table}: ${expected ?? 'missing'} before, ${actual ?? 'missing'} after`);
    }
    console.log(mismatches.length === 0 ? 'Restore verified: every table has the same row count.' : 'Restore FAILED.');
    return mismatches.length === 0;
  } finally {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await rm(dumpFile, { force: true });
  }
}

drill().then(
  (verified) => {
    process.exitCode = verified ? 0 : 1;
  },
  (error: unknown) => {
    console.error(error);
    console.error(`\nIf Postgres is not running: ${START_POSTGRES_HINT}`);
    process.exitCode = 1;
  },
);
