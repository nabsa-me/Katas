import type { Queryable } from '../../lib/database';
import type { IssueRow } from './pagination.problem';

/** Where the previous page ended: the sort key of its last row. `id` breaks ties between equal dates. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export interface IssuePage {
  issues: IssueRow[];
  next: Cursor | null;
}

export const KEYSET_PAGE_SQL = `
  SELECT id, title, created_at AS "createdAt"
  FROM issues
  WHERE team_id = $1 AND (created_at, id) < ($2, $3)
  ORDER BY created_at DESC, id DESC
  LIMIT $4`;

const FIRST_PAGE_SQL = `
  SELECT id, title, created_at AS "createdAt"
  FROM issues
  WHERE team_id = $1
  ORDER BY created_at DESC, id DESC
  LIMIT $2`;

/**
 * Keyset pagination: "the next `pageSize` rows after this one". With an index on (team_id, created_at, id)
 * the database jumps straight to the cursor, so page 90 costs the same as page 1, and rows inserted
 * meanwhile never shift the pages that follow.
 */
export async function teamIssuesAfter(
  db: Queryable,
  teamId: number,
  cursor: Cursor | null,
  pageSize = 20,
): Promise<IssuePage> {
  const { rows } = cursor
    ? await db.query<IssueRow>(KEYSET_PAGE_SQL, [teamId, cursor.createdAt, cursor.id, pageSize])
    : await db.query<IssueRow>(FIRST_PAGE_SQL, [teamId, pageSize]);
  const last = rows.at(-1);
  return { issues: rows, next: last && rows.length === pageSize ? { createdAt: last.createdAt, id: last.id } : null };
}

/** The cursor as an opaque URL-safe string for an API response (`?after=…`). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id])).toString('base64url');
}

/** Parses a cursor that came from a client: never trusted, so anything malformed is rejected. */
export function decodeCursor(encoded: string): Cursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid cursor');
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error('Invalid cursor');
  const [createdAt, id] = decoded as unknown[];
  const date = typeof createdAt === 'string' ? new Date(createdAt) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime()) || typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id)) {
    throw new Error('Invalid cursor');
  }
  return { createdAt: date, id };
}
