import type { Queryable } from '../../lib/database';

/**
 * App version 2 knows only `display_name`. It ships once the column is backfilled and NOT NULL, runs next
 * to v1 during the rolling deploy, and keeps working after the contract migration drops `full_name`.
 */
export interface PersonV2 {
  id: string;
  displayName: string;
  email: string;
}

export async function addPerson(db: Queryable, displayName: string, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO people (display_name, email) VALUES ($1, $2) RETURNING id',
    [displayName, email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('INSERT … RETURNING returned no row');
  return id;
}

export async function findPerson(db: Queryable, id: string): Promise<PersonV2 | undefined> {
  const { rows } = await db.query<PersonV2>(
    'SELECT id, display_name AS "displayName", email FROM people WHERE id = $1',
    [id],
  );
  return rows[0];
}

export async function renamePerson(db: Queryable, id: string, displayName: string): Promise<void> {
  await db.query('UPDATE people SET display_name = $2 WHERE id = $1', [id, displayName]);
}

/** The new feature that needs `people_display_name_idx`. */
export async function findByDisplayName(db: Queryable, displayName: string): Promise<PersonV2[]> {
  const { rows } = await db.query<PersonV2>(
    'SELECT id, display_name AS "displayName", email FROM people WHERE display_name = $1 ORDER BY id',
    [displayName],
  );
  return rows;
}
