# postgres-rds

Five katas on running PostgreSQL behind an application on Amazon RDS, solved and explained: schema design with constraints, zero-downtime migrations, least-privilege users, query performance and backups. Every exercise runs against a real Postgres 16 in Docker; the flawed version sits next to the fixed one, and the tests prove the difference with the errors, locks and query plans Postgres itself reports. Nothing touches AWS: the RDS parts are explained, and their commands are written out but commented.

## Run

Requires Node 22.12 or later and Docker.

```bash
cd postgres-rds
npm install
docker compose up -d --wait   # Postgres 16 on localhost:5807, data in memory
npm test                      # every exercise against that Postgres (each test file uses its own database)
npm run check                 # type checking
npm run explain               # query plans and timings before and after each performance fix
npm run restore-drill         # backup → destroy → restore → verify row counts
docker compose exec postgres psql -U postgres   # a psql session, to try things by hand
docker compose down           # stop Postgres; nothing is kept
```

The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                                                  | What it practises                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Schema design](src/exercises/schema-design/README.md)                                                    | Normalizing, constraints, exclusion constraints, `ON DELETE` per relationship, indexes, JSONB, DynamoDB vs relational |
| [Versioned migrations with expand/contract](src/exercises/versioned-migrations-expand-contract/README.md) | dbmate, dual-write trigger, batched backfill, `NOT VALID` + `VALIDATE`, `CREATE INDEX CONCURRENTLY`, `lock_timeout`   |
| [Least-privilege users](src/exercises/least-privilege-users/README.md)                                    | Group and login roles, `PUBLIC`, default privileges, report views, RDS IAM authentication, rotation                   |
| [Query performance](src/exercises/query-performance/README.md)                                            | `EXPLAIN (ANALYZE, BUFFERS)`, composite index order, N+1, keyset pagination, pool sizing, RDS Proxy                   |
| [Backups and restore](src/exercises/backups-and-restore/README.md)                                        | RPO and RTO, automated backups, point-in-time recovery, snapshots, `pg_dump`/`pg_restore` drill                       |

## Postgres cheat sheet

| I need…                                          | Use                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| To see what a query really does                  | `EXPLAIN (ANALYZE, BUFFERS) <query>` (it runs the query: wrap writes in `BEGIN … ROLLBACK`)             |
| Fresh planner statistics after a bulk load       | `ANALYZE <table>` (`VACUUM ANALYZE` also updates the visibility map for index-only scans)               |
| An index on a busy table                         | `CREATE INDEX CONCURRENTLY` (outside a transaction), then check `pg_index.indisvalid`                   |
| A new required column without a long lock        | Add it nullable → backfill in batches → `CHECK (… IS NOT NULL) NOT VALID` → `VALIDATE` → `SET NOT NULL` |
| To rename a column without breaking the old app  | Expand/contract: new column, dual-write trigger, backfill, switch reads, drop the old one last          |
| DDL that fails fast instead of blocking everyone | `SET LOCAL lock_timeout = '5s'` at the start of the migration                                           |
| Who is blocking whom                             | `SELECT pid, pg_blocking_pids(pid), wait_event_type, query FROM pg_stat_activity`                       |
| No overlapping date ranges per key               | `EXCLUDE USING gist (key WITH =, daterange(from, to) WITH &&)` with `btree_gist`                        |
| Case-insensitive unique emails                   | `CREATE UNIQUE INDEX … ON people (lower(email))`                                                        |
| Pagination that stays fast on deep pages         | Keyset: `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT n`                   |
| Many ids in one query                            | `WHERE id = ANY($1::bigint[])`                                                                          |
| Privileges on tables created in the future       | `ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA … GRANT … ON TABLES TO …`                          |
| To check what a role can do                      | `has_table_privilege('role', 'table', 'INSERT')`, `has_schema_privilege(…)`, `\dp` in psql              |
| A logical backup of one database                 | `pg_dump --format=custom`, restored with `pg_restore --exit-on-error`                                   |

## SQLSTATE codes used in the tests

| Code    | Name                   | Raised by                                                   |
| ------- | ---------------------- | ----------------------------------------------------------- |
| `23502` | not_null_violation     | `NOT NULL`, adding a `NOT NULL` column to a table with rows |
| `23503` | foreign_key_violation  | Missing parent row, `ON DELETE RESTRICT`                    |
| `23505` | unique_violation       | `UNIQUE` constraint or unique index                         |
| `23514` | check_violation        | `CHECK` constraint                                          |
| `23P01` | exclusion_violation    | Exclusion constraint (overlapping ranges)                   |
| `25001` | active_sql_transaction | `CREATE INDEX CONCURRENTLY` inside a transaction            |
| `42501` | insufficient_privilege | Missing privilege, not the owner, no `CONNECT`              |
| `42703` | undefined_column       | A query naming a column that was renamed or dropped         |
| `55P03` | lock_not_available     | `lock_timeout` expired while waiting for a lock             |

## RDS cheat sheet

| I need…                                   | Use                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| To lose at most ~5 minutes of data        | Automated backups (retention 1–35 days) and point-in-time recovery                                                                                                             |
| A rollback point before a risky migration | `aws rds create-db-snapshot`, then `aws rds wait db-snapshot-available`                                                                                                        |
| To restore                                | A **new** instance: `restore-db-instance-to-point-in-time` or `restore-db-instance-from-db-snapshot`, with subnet group, security groups and parameter group passed explicitly |
| No passwords in the application           | IAM authentication: `GRANT rds_iam TO <user>`, `rds-db:connect` policy, `@aws-sdk/rds-signer`                                                                                  |
| Rotated passwords                         | Secrets Manager: managed master password, rotation for application users                                                                                                       |
| Many Lambda functions on one database     | RDS Proxy, `max: 1` per execution environment, no session state (`SET`) to avoid pinning                                                                                       |

## Data

All data is **fictional** and generated in SQL next to each exercise: teams, people, initiatives and Jira-like issues with made-up names, keys and dates (`generate_series` for the 100,000 issues of the performance exercise).
