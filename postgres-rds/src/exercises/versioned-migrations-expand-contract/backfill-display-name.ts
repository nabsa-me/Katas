import type { Queryable } from '../../lib/database';

export interface BackfillProgress {
  batches: number;
  updated: number;
}

/**
 * Copies `full_name` into `display_name` in batches, walking the primary key. Pass a pool, not a client
 * inside a transaction: each batch is its own statement and commits on its own, so row locks last one
 * batch, a failure loses at most one batch, and running it again skips the rows already copied.
 * One `UPDATE` for the whole table would lock every row until it finishes and bloat the table at once.
 */
export async function backfillDisplayName(db: Queryable, batchSize = 1_000): Promise<BackfillProgress> {
  const progress: BackfillProgress = { batches: 0, updated: 0 };
  let lastId = '0';
  for (;;) {
    const { rows } = await db.query<{ last_id: string | null; updated: number }>(
      `WITH batch AS (
         SELECT id FROM people WHERE id > $1 ORDER BY id LIMIT $2
       ), changed AS (
         UPDATE people SET display_name = people.full_name
         FROM batch
         WHERE people.id = batch.id AND people.display_name IS NULL
         RETURNING people.id
       )
       SELECT (SELECT max(id) FROM batch) AS last_id, (SELECT count(*)::int FROM changed) AS updated`,
      [lastId, batchSize],
    );
    const batch = rows[0];
    if (!batch?.last_id) return progress;
    lastId = batch.last_id;
    progress.batches += 1;
    progress.updated += batch.updated;
  }
}
