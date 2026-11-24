import { readFileSync } from 'node:fs';
import { createTemporaryDatabase, type TemporaryDatabase } from '../../lib/database';

const seedSql = readFileSync(new URL('./seed.sql', import.meta.url), 'utf8');

/** A temporary database with 50 teams and 100,000 issues, and no index beyond the primary keys. */
export async function createSeededDatabase(prefix: string): Promise<TemporaryDatabase> {
  const db = await createTemporaryDatabase(prefix);
  try {
    await db.pool.query(seedSql);
    // Statistics for the planner, and a visibility map so index-only scans can skip the table.
    // Without ANALYZE right after a bulk load, the planner guesses and the plans in the tests drift.
    await db.pool.query('VACUUM ANALYZE');
    return db;
  } catch (error) {
    await db.drop();
    throw error;
  }
}

/** Reads one of the exercise's SQL files (the index definitions). */
export function readSql(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}
