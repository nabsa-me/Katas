import type { Pool } from 'pg';
import { z } from 'zod';
import type { DatabaseProbe } from './health';
import { ISSUE_STATUSES, type Issue, type IssueRepository } from './issues';
import type { Logger } from './logger';

/** Rows are external data too: a migration that renames a column must fail here, loudly, not in a client. */
const issueRowSchema = z.object({
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  assignee: z.string().nullable(),
  updated_at: z.date(),
});

const COLUMNS = 'key, title, status, assignee, updated_at';

function toIssue(row: unknown): Issue {
  const { updated_at, ...rest } = issueRowSchema.parse(row);
  return { ...rest, updatedAt: updated_at.toISOString() };
}

/**
 * Adapter of `IssueRepository` over a `pg.Pool`. Its debug lines carry the request's correlation id although
 * nothing here knows about requests: the logger's mixin reads it from `AsyncLocalStorage`.
 */
export function createPostgresIssueRepository(pool: Pool, logger: Logger): IssueRepository {
  async function query(name: string, text: string, values: unknown[]): Promise<Issue[]> {
    const started = performance.now();
    const { rows } = await pool.query(text, values);
    logger.debug({ query: name, rows: rows.length, durationMs: Math.round(performance.now() - started) }, 'query');
    return rows.map(toIssue);
  }

  return {
    // Served by the index on (status, updated_at DESC): equality first, then the sort, so LIMIT stops early.
    list: ({ status, limit }) =>
      query('issues.list', `SELECT ${COLUMNS} FROM issues WHERE status = $1 ORDER BY updated_at DESC LIMIT $2`, [
        status,
        limit,
      ]),
    get: async (key) => (await query('issues.get', `SELECT ${COLUMNS} FROM issues WHERE key = $1`, [key]))[0],
  };
}

/** The readiness check: one round trip through a pool that only the probe uses, so a busy app pool can't fail it. */
export function createPostgresProbe(pool: Pool): DatabaseProbe {
  return {
    name: 'postgres',
    check: async () => {
      await pool.query('SELECT 1');
    },
  };
}
