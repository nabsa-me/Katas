import { escapeIdentifier } from 'pg';
import type { Queryable } from '../../lib/database';

/** Table name → exact number of rows. */
export type RowCounts = Record<string, number>;

export interface CountMismatch {
  table: string;
  before: number | undefined;
  after: number | undefined;
}

/**
 * Exact `count(*)` of every table in schema public. Exact on purpose: `pg_class.reltuples` and
 * `pg_stat_user_tables` are estimates, and a restore check must not pass on an estimate.
 */
export async function countRows(db: Queryable): Promise<RowCounts> {
  const { rows: tables } = await db.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const counts: RowCounts = {};
  for (const { name } of tables) {
    const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${escapeIdentifier(name)}`);
    counts[name] = rows[0]?.count ?? 0;
  }
  return counts;
}

/** Every table whose count differs, including tables missing on either side. Empty means the restore matches. */
export function compareCounts(before: RowCounts, after: RowCounts): CountMismatch[] {
  const tables = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return tables
    .filter((table) => before[table] !== after[table])
    .map((table) => ({ table, before: before[table], after: after[table] }));
}
