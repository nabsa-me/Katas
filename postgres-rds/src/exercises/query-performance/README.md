# Query performance

## Statement

The issues API has 50 teams and 100,000 issues ([`seed.sql`](./seed.sql)), and four things are slow or fragile:

1. A dashboard tile counts the issues a team opened in a month. It reads the whole table; someone added an index, in the wrong column order ([`composite-index.problem.sql`](./composite-index.problem.sql)):

   ```sql
   SELECT count(*) FROM issues WHERE team_id = $1 AND created_at >= $2 AND created_at < $3;
   CREATE INDEX issues_created_at_team_id ON issues (created_at, team_id);
   ```

2. The team dashboard loads the teams, then the open-issue count of each one in a loop ([`open-issues.problem.ts`](./open-issues.problem.ts)): 51 queries for 50 teams.
3. The issue list pages with `LIMIT 20 OFFSET (page - 1) * 20` ([`pagination.problem.ts`](./pagination.problem.ts)). Deep pages get slower, and users see the same issue twice when a new one is created while they page.
4. The service uses `new Pool()` with the defaults, and a Lambda version of it exhausted the database's connections during a traffic spike.

Measure each problem, fix it, and prove the fix with the query plan, not with a stopwatch.

## What gets assessed

- Reading `EXPLAIN (ANALYZE, BUFFERS)`: node types, actual rows, rows removed by filter, pages read.
- Composite index column order: equality columns first, then the range or sort column.
- Spotting an N+1 and replacing it with a join or a batched `= ANY($1)` query.
- Keyset pagination with a row comparison and the index that serves it.
- Sizing a connection pool from the database's connection budget, and RDS Proxy for Lambda.

## How to approach it, step by step

1. Run the query with `EXPLAIN (ANALYZE, BUFFERS)`. Look for `Seq Scan` with a large `Rows Removed by Filter`, and compare actual rows with estimated rows.
2. If the statistics may be stale (right after a bulk load), run `ANALYZE` first; the planner decides from them.
3. Design the index from the `WHERE` and `ORDER BY`: columns compared with `=` first, then the one compared with a range or used to sort. Check the new plan uses it and reads fewer pages.
4. For slow pages, count the queries per request (a counter in tests, `pg_stat_statements` in production). A count that grows with the data is an N+1.
5. For pagination, sort by a unique key (`created_at, id`) and ask for "the rows after this one" instead of "skip N rows".
6. For connections, start from `max_connections`, subtract what is reserved, divide by the most instances that can run at once.

## Solution explained

Every case runs against a real Postgres seeded with [`seed.sql`](./seed.sql) and `VACUUM ANALYZE`. [`plan.ts`](./plan.ts) runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, validates the output and walks the plan tree (`planNodes`), so the tests assert on the plan itself. `npm run explain` ([`explain.ts`](./explain.ts)) prints every plan below in text form with its timing.

**Reading a plan.** Each node shows the planner's estimate (`cost=… rows=…`) and, with `ANALYZE`, what really happened (`actual time=… rows=… loops=…`). `Rows Removed by Filter` is work thrown away. `Buffers: shared hit=… read=…` counts 8 kB pages found in memory (`hit`) or read from disk or the OS cache (`read`); it is the most stable measure of cost, because it does not depend on how busy the machine is. A node's buffers include its children's, so the root's numbers are the query's total. Estimates far from actual rows mean stale statistics (`ANALYZE`) or correlated columns.

**Case 1: composite index order.** Without an index the count reads all 841 pages of the table and discards 99,827 rows to keep 173 (`Seq Scan`). With `(created_at, team_id)` the index is ordered by date: June is one contiguous range of 8,640 entries across all 50 teams, and Postgres walks all of them to keep team 7's: 37 pages. With `(team_id, created_at, id)` ([`composite-index.sql`](./composite-index.sql)) all of team 7's entries sit together, ordered by date, so June is one short contiguous slice: 5 pages, an `Index Only Scan` that never touches the table (`Heap Fetches: 0`, thanks to the visibility map `VACUUM` maintains). The rule: columns compared with `=` first, then the one compared with a range or used in `ORDER BY`. `id` at the end makes the order unique, which keyset pagination needs, and `team_id` first also serves the foreign key. [`composite-index.test.ts`](./composite-index.test.ts) asserts `Seq Scan` without an index, `Index Only Scan` on the right one, and at least five times fewer pages than with the wrong order. The planner is never forced (`enable_seqscan` stays on): the test only creates the index and runs `ANALYZE` after the bulk load.

**Case 2: N+1.** The flawed dashboard runs one query for the teams and one per team. Each query is fast; the round trips are not: 51 statements, each with its own network latency, parsing and planning. On a laptop `npm run explain` measures about 200 ms for 51 queries against about 50 ms for one, and across availability zones each extra round trip adds up to about another millisecond. [`open-issues.ts`](./open-issues.ts) asks once and lets the database join and count (`LEFT JOIN … GROUP BY`, `count(…) FILTER (WHERE …)`). When the ids come from somewhere else, such as another service or a GraphQL resolver, batch them: `WHERE team_id = ANY($1::int[])`, one query whatever the number of ids, with a 0 filled in for teams without rows. [`query-counter.ts`](./query-counter.ts) wraps the pool and counts statements; [`n-plus-one.test.ts`](./n-plus-one.test.ts) asserts 51 queries for the flawed version, one for each fix, and the same numbers from all of them. In production, `pg_stat_statements` shows the same pattern as one cheap statement with a huge `calls` count.

**Case 3: keyset pagination.** `OFFSET 1780` still produces the first 1,780 rows and throws them away: the plan for page 90 reads all 2,000 of team 7's issues and sorts them. Keyset pagination ([`pagination.ts`](./pagination.ts)) remembers the sort key of the last row and asks for what comes after it:

```sql
WHERE team_id = $1 AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 20
```

The row comparison `(created_at, id) < ($2, $3)` matches the index `(team_id, created_at, id)` column for column, so Postgres starts an `Index Scan Backward` exactly at the cursor and reads 20 rows, on page 90 as on page 1. `id` breaks ties between issues created at the same instant; without it, rows with equal dates would be skipped or repeated. It also fixes correctness: [`pagination.test.ts`](./pagination.test.ts) creates an issue between page 1 and page 2, and OFFSET repeats the last row of page 1 while keyset does not. The test also walks all 2,000 issues of a team once each. The trade-off: no "jump to page 57", only next (and previous, with the comparison reversed).

`created_at` is `timestamptz(3)`. A JavaScript `Date` holds milliseconds; Postgres stores microseconds by default. With microseconds, a cursor read into a `Date` and sent back would be slightly earlier than the stored value and the comparison would skip or repeat rows. Storing milliseconds makes the round trip exact. The cursor leaves the API as an opaque base64url string, and [`decodeCursor`](./pagination.ts) validates whatever a client sends back before it reaches SQL.

**Case 4: connection pooling.** Each Postgres connection is a server process with its own memory, and past the instance's CPU and I/O capacity, more connections only make queries queue inside the database. [`pool.ts`](./pool.ts) sizes the pool from a budget: `(max_connections − reserved) / instances`, where instances counts the most that can run at once, both colours during a blue/green deploy included (400 connections, 40 reserved, 12 instances → 30 each; 24 instances during the deploy → 15). It also sets `connectionTimeoutMillis` (fail fast when the pool is exhausted), `idleTimeoutMillis`, `maxLifetimeSeconds`, a server-side `statement_timeout` and an `application_name` that shows up in `pg_stat_activity`; [`pool.test.ts`](./pool.test.ts) checks the server sees them.

**Lambda and RDS Proxy.** Every Lambda execution environment is a separate process with its own pool, so 300 concurrent invocations with `max: 10` can open 3,000 connections. Create the pool outside the handler (reused across invocations of the same environment), use `max: 1`, and cap the function's reserved concurrency so `concurrency × 1` fits the budget. Better, connect through RDS Proxy: it keeps a small pool of database connections and multiplexes client connections onto them at transaction boundaries. Multiplexing stops when a session is _pinned_: for Postgres, `SET` outside a transaction, `PREPARE`/`EXECUTE`, temporary tables, cursors, `LISTEN`, session advisory locks and statements over 16 kB pin the connection. Use `SET LOCAL` inside transactions, move session settings into the proxy's initialization query, and watch the `DatabaseConnectionsCurrentlySessionPinned` metric.

## Common mistakes

| Symptom                                                     | Cause                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| An index exists and the plan still says `Seq Scan`          | Wrong column order, a function on the column (`lower(email)` needs an expression index), or stale statistics. |
| The plan changed after a bulk load and the query got slow   | No `ANALYZE` after loading: the planner still believes the table is small.                                    |
| A two-column index barely helps                             | The range column comes before the equality column.                                                            |
| A page gets slower as the data grows, each query looks fast | An N+1: count the queries per request.                                                                        |
| Deep pages time out; users see duplicates while paging      | `OFFSET` pagination. Use keyset with a unique sort key.                                                       |
| Keyset pagination skips rows with the same timestamp        | The sort key is not unique. Add `id` to the `ORDER BY`, the comparison and the index.                         |
| Keyset cursors skip or repeat rows across pages             | Microsecond timestamps round-tripped through a millisecond `Date`.                                            |
| `remaining connection slots are reserved` during a deploy   | Pools sized for the normal instance count; the deploy doubled it.                                             |
| RDS Proxy in place but database connections still grow      | Pinned sessions: `SET`, prepared statements or temporary tables on every connection.                          |

## Practice

Add "issues of a team with a given status, newest first, paginated" and design the index for it (where does `status` go?). Prove it with a test that asserts the index is used and that page 50 reads one page of rows.
