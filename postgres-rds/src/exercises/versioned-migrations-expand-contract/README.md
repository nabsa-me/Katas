# Versioned migrations with expand/contract

## Statement

The `people` table has a `full_name` column that has to become `display_name`, and the new app version also searches people by that name. Deploys are rolling: for several minutes the old version (app v1, which only knows `full_name`) and the new one (app v2, which only knows `display_name`) serve traffic at the same time. The table is busy and has rows.

The first attempt shipped three migrations, each of which takes production down in its own way:

```sql
-- rename-column.problem.sql: app v1 is still running
ALTER TABLE people RENAME COLUMN full_name TO display_name;
-- create-index.problem.sql: on a busy table
CREATE INDEX people_display_name_idx ON people (display_name);
-- add-not-null.problem.sql: on a table that already has rows
ALTER TABLE people ADD COLUMN display_name text NOT NULL;
```

Symptoms: every request served by app v1 fails with `column "full_name" does not exist` (`42703`) until the rollout finishes; inserts and updates hang while the index builds, and requests time out; the `NOT NULL` migration fails with `23502` and the deploy stops halfway.

Rewrite the change as a sequence of versioned migrations (one per release) that never breaks the version still running, builds the index without blocking writes and makes the column required without a long lock.

## What gets assessed

- Expand/contract: add the new structure, run both side by side, migrate the data, switch, and only then remove the old one.
- Keeping two app versions working at once with a dual-write trigger, and backfilling in batches.
- Knowing which lock each DDL statement takes and for how long: `CREATE INDEX CONCURRENTLY`, `NOT VALID` + `VALIDATE`, `lock_timeout`.
- Versioned migrations as plain SQL files with dbmate, including per-migration transaction control.
- Proving it with a test that deploys the migrations one by one and runs the app between steps.

## How to approach it, step by step

1. Write down which app versions are running during each deploy. Any migration must work with **every** version that can be running at that moment, the old one included.
2. Expand: add `display_name` as a nullable column without a default. It is a catalog-only change.
3. Keep both columns in sync while both versions write: a `BEFORE INSERT OR UPDATE` trigger copies whichever side changed.
4. Backfill the existing rows in batches, committing each batch, and make the script safe to run again.
5. Make the column required in steps: `CHECK (display_name IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT`, then `SET NOT NULL`, then drop the redundant check.
6. Build the index with `CREATE INDEX CONCURRENTLY`, in a migration that runs outside a transaction.
7. Deploy app v2, which reads and writes `display_name` only.
8. Contract, once no app v1 instance is left: drop the trigger and `full_name`.
9. Test it: apply the migrations one at a time against a real database and run each app version between steps.

## Solution explained

The eight migrations live in [`migrations/`](./migrations/), one file per release, in dbmate's format. [`app-v1.ts`](./app-v1.ts) and [`app-v2.ts`](./app-v2.ts) are the two versions of the application's queries, and [`backfill-display-name.ts`](./backfill-display-name.ts) is the batched backfill.

**The release plan.** Each row is one deploy. "Lock" is the strongest lock the step takes on `people` and how long it holds it.

| Migration                          | Lock on `people`                          | Running during and after it | What it does                                         |
| ---------------------------------- | ----------------------------------------- | --------------------------- | ---------------------------------------------------- |
| `create_people`                    | (new table)                               | v1                          | The starting point                                   |
| `add_display_name`                 | `ACCESS EXCLUSIVE`, milliseconds          | v1                          | Expand: nullable column, catalog-only                |
| `sync_display_name_with_full_name` | `SHARE ROW EXCLUSIVE`, milliseconds       | v1                          | Dual-write trigger; then the backfill runs           |
| `check_display_name_not_null`      | `ACCESS EXCLUSIVE`, milliseconds          | v1                          | `CHECK … NOT VALID`: new rows only, no scan          |
| `validate_display_name_not_null`   | `SHARE UPDATE EXCLUSIVE`, during the scan | v1                          | Scans existing rows; reads and writes continue       |
| `set_display_name_not_null`        | `ACCESS EXCLUSIVE`, milliseconds          | v1 and v2                   | `SET NOT NULL` without a scan, then drops the check  |
| `index_display_name_concurrently`  | `SHARE UPDATE EXCLUSIVE`, during build    | v1 and v2                   | Index for v2's search; writes continue               |
| `drop_full_name`                   | `ACCESS EXCLUSIVE`, milliseconds          | v2                          | Contract: trigger and old column gone (catalog-only) |

**Dual write with a trigger.** While v1 and v2 run side by side, v1 writes only `full_name` and v2 writes only `display_name`. The trigger keeps both equal: on insert it fills whichever is missing, on update it copies the column that changed. Doing it in the database means neither app version needs to know about the other, and rows written by any other path (a console, a batch job) stay in sync too. The test proves it both ways: a person added by v1 is read by v2 with the same name, and a rename by v2 is seen by v1.

**Backfill in batches.** The rows that existed before the trigger still have `display_name = NULL`. One `UPDATE people SET display_name = full_name` would lock every row until it finished, generate the whole table's dead tuples and WAL at once, and lose everything on failure. The backfill walks the primary key in batches of 1,000 (`WITH batch AS (SELECT id … WHERE id > $1 ORDER BY id LIMIT $2) UPDATE … FROM batch`), each batch its own statement and therefore its own commit. It returns how many batches and rows it processed, and running it again updates nothing, so a failure halfway is fixed by running it again. On a large production table, add a pause between batches so replicas and autovacuum keep up.

**`NOT NULL` in safe steps.** `ALTER COLUMN … SET NOT NULL` on its own scans the whole table while holding `ACCESS EXCLUSIVE`, which blocks even reads. The safe sequence splits it:

1. `ADD CONSTRAINT … CHECK (display_name IS NOT NULL) NOT VALID` is enforced for new and updated rows at once, but does not scan existing ones, so its `ACCESS EXCLUSIVE` lock is momentary.
2. `VALIDATE CONSTRAINT` scans the existing rows holding only `SHARE UPDATE EXCLUSIVE`: reads and writes carry on.
3. `SET NOT NULL` (Postgres 12+) sees the validated check and skips the scan. The test proves it with Postgres's own debug output: with `client_min_messages = debug1`, this step reports `existing constraints on column "people.display_name" are sufficient to prove that it does not contain nulls`, while a `SET NOT NULL` without the check reports `verifying table "people"`, the full scan.
4. The check is now redundant and is dropped.

**`CREATE INDEX CONCURRENTLY`.** A plain `CREATE INDEX` takes a `SHARE` lock for the whole build: reads continue, writes wait. Worse, it first queues behind any open transaction that wrote to the table, and every write that arrives after it queues behind the index. `CONCURRENTLY` takes `SHARE UPDATE EXCLUSIVE`, which does not conflict with inserts, updates or deletes, at the cost of scanning the table twice and waiting for older transactions. It cannot run inside a transaction block, so the migration starts with `-- migrate:up transaction:false`. If it fails halfway it leaves an `INVALID` index that is still maintained on every write: check `pg_index.indisvalid`, drop it with `DROP INDEX CONCURRENTLY` and run the migration again.

[`unsafe-migrations.test.ts`](./unsafe-migrations.test.ts) reproduces a deploy on a busy table: a transaction that wrote to `people` stays open, the index migration starts, and app v1 tries to insert with a 300 ms `lock_timeout`. With the plain `CREATE INDEX`, the insert fails with `55P03` (lock not available); with `CONCURRENTLY`, it succeeds while the index build is still waiting.

**`lock_timeout` in every DDL migration.** Even a millisecond DDL step needs its lock first, and while it waits behind a long transaction, every query on the table queues behind it. Each transactional migration that alters `people` starts with `SET LOCAL lock_timeout = '5s'`: if the lock is not free in 5 seconds the migration fails cleanly and can be retried, instead of stalling the application. The concurrent index migration does not set it, because timing out there leaves the invalid index behind.

**Contract, and why it cannot be rolled back.** `drop_full_name` ships only after the last v1 instance is gone; the last step of the test shows that v1 would fail with `42703` right after it. Its down section raises an exception on purpose: the dropped column's data is gone, so the way back is rolling forward with a new migration or restoring the snapshot taken before the step. Every other step has a working down section, and the rollback test undoes them all in reverse order.

**dbmate.** Migrations are plain SQL files named `<version>_<description>.sql`, with `-- migrate:up` and `-- migrate:down` sections. dbmate records applied versions in `schema_migrations`, wraps each migration in a transaction unless it says `transaction:false`, and the same files run locally, in CI and against RDS (`dbmate --url "$DATABASE_URL" up`). Plain SQL means the reviewer sees exactly what runs, locks included. Useful flags: `--no-dump-schema` (skip `pg_dump` after each run), `--strict` (fail on out-of-order migrations) and `--migration-lock` (concurrent deploys wait for each other). [`migrations.ts`](./migrations.ts) runs the dbmate binary from the npm package; the test deploys "release N" by running `dbmate up` against a directory holding only the first N files.

**How it is proven.** [`expand-contract.test.ts`](./expand-contract.test.ts) applies the migrations one by one against a database with 2,500 existing people and, after each step, runs app v1 (add, rename, read) and, from `set_display_name_not_null` on, app v2 too. [`unsafe-migrations.test.ts`](./unsafe-migrations.test.ts) shows each flawed migration failing (`42703`, `55P03`, `23502`), the concurrent index failing inside a transaction (`25001`), and the safe versions succeeding.

## Common mistakes

| Symptom                                                                  | Cause                                                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `column "full_name" does not exist` from the old version during a deploy | A rename or drop shipped while the old version was still running. Expand first, contract after it is gone.            |
| Every query on a table hangs during a deploy, then recovers              | A DDL statement queued for its lock behind a long transaction. Set `lock_timeout` in migrations.                      |
| Inserts time out while an index is being created                         | Plain `CREATE INDEX` blocks writes for the whole build. Use `CONCURRENTLY`.                                           |
| `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`        | The migration tool wrapped it in a transaction. In dbmate, `-- migrate:up transaction:false`.                         |
| An index exists but the planner never uses it                            | A failed concurrent build left it `INVALID`. Drop it concurrently and build it again (`IF NOT EXISTS` would skip it). |
| The backfill locked the table for minutes and replicas fell behind       | One `UPDATE` for every row. Batch it, commit per batch, pause between batches.                                        |
| `SET NOT NULL` took a long exclusive lock                                | No validated `CHECK (… IS NOT NULL)` beforehand, so Postgres had to scan the table under `ACCESS EXCLUSIVE`.          |

## Practice

Split `people.email` into `email_local_part` and `email_domain` with the same expand/contract sequence, and add a test that runs both app versions between the steps.
