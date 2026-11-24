import type { QueryResultRow } from 'pg';
import type { Queryable } from '../../lib/database';

export interface CountingQueryable extends Queryable {
  /** Statements sent so far: one per round trip to the database. */
  readonly queries: number;
}

/** Wraps a pool and counts the statements sent through it. An N+1 shows up as a count that grows with the data. */
export function countingQueries(db: Queryable): CountingQueryable {
  let queries = 0;
  return {
    get queries() {
      return queries;
    },
    query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      queries += 1;
      return db.query<R>(text, values);
    },
  };
}
