import type { Queryable } from '../../lib/database';

/** App version 1 knows only `full_name`. It keeps serving traffic while the expand migrations deploy. */
export interface PersonV1 {
  id: string;
  fullName: string;
  email: string;
}

export async function addPerson(db: Queryable, fullName: string, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO people (full_name, email) VALUES ($1, $2) RETURNING id',
    [fullName, email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('INSERT … RETURNING returned no row');
  return id;
}

export async function findPerson(db: Queryable, id: string): Promise<PersonV1 | undefined> {
  const { rows } = await db.query<PersonV1>('SELECT id, full_name AS "fullName", email FROM people WHERE id = $1', [
    id,
  ]);
  return rows[0];
}

export async function renamePerson(db: Queryable, id: string, fullName: string): Promise<void> {
  await db.query('UPDATE people SET full_name = $2 WHERE id = $1', [id, fullName]);
}
