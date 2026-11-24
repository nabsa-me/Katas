# Backups and restore

## Statement

The issues database runs on RDS for PostgreSQL with automated backups "on". Nobody has ever restored one, nobody knows how long it would take, and next week's release includes the contract migration that drops `people.full_name`. The team's whole recovery plan is "RDS has backups".

Write the runbook the on-call engineer follows before a risky migration and after data loss (automated backups and retention, point-in-time recovery, a manual snapshot before the migration, restoring to a new instance, verifying and cutting over), with the AWS CLI commands ready but commented out. Then practise locally: a script that backs up a database, destroys it, restores it and proves nothing was lost.

## What gets assessed

- RPO and RTO: what each one means, and which mechanism sets each.
- How RDS backups work: automated backups and retention, point-in-time recovery, manual snapshots, and that every restore creates a **new** instance.
- A safe procedure: snapshot before a risky change, restore, verify, cut over, clean up.
- `pg_dump` and `pg_restore`: formats, versions, what they include and what they do not.
- A drill that verifies, and fails loudly, instead of a restore that is assumed to work.

## How to approach it, step by step

1. Define RPO and RTO for the service; they decide the backup settings and how much the procedure has to be rehearsed.
2. List what RDS provides (retention, point-in-time recovery, snapshots) and what it does not (a restore in place, a restore with your network settings by default).
3. Write the procedure in the order someone under pressure needs it: before the change, restore, verify, cut over, clean up. Put the commands in, commented out, with placeholders that cannot be run by accident.
4. Build the local drill: seed a database, `pg_dump`, drop the database, create it again, `pg_restore`.
5. Verify with exact numbers: count every table before and after, and exit non-zero on any difference.
6. Time the backup and the restore: that is the start of a measured RTO.

## Solution explained

[`runbook.md`](./runbook.md) is the runbook. [`restore-drill.ts`](./restore-drill.ts) is the drill (`npm run restore-drill`), [`row-counts.ts`](./row-counts.ts) counts and compares, and [`drill-data.sql`](./drill-data.sql) holds the fictional data, loaded on the schema from the [schema design exercise](../schema-design/README.md).

**RPO and RTO.** RPO is how much data you can lose, measured in time; RTO is how long you can be down. On RDS, point-in-time recovery sets the RPO: transaction logs are uploaded every 5 minutes, so `LatestRestorableTime` trails the present by about 5 minutes. RTO is everything else: creating the instance, replaying logs, verifying, switching the application. Only a rehearsal measures it, which is why the runbook has a table for the measured values.

**What RDS backs up.** Automated backups are a daily snapshot plus the transaction logs, kept for the retention period (0–35 days; 0 disables them, and point-in-time recovery with them). Point-in-time recovery restores to any second between the earliest backup and `LatestRestorableTime`. Manual snapshots are taken on demand and kept until deleted: the one to take right before a risky migration, so the rollback point is exactly "before the change".

**Every restore is a new instance.** Neither a snapshot restore nor point-in-time recovery overwrites the existing instance. The new one gets, unless you say otherwise, the default security group, the default subnet group and the default parameter group, and a single-AZ deployment; the runbook passes all of them explicitly. Then you choose between repairing production from the restored copy (only some rows were lost) and cutting over to it (production is unusable), by updating the endpoint the application reads or by swapping instance identifiers.

**The drill.** `restore-drill.ts` runs `pg_dump` and `pg_restore` inside the Postgres container (`docker compose exec -T postgres …`), so the tools' version always matches the server's, and streams the dump to and from a file on the host:

1. Create the database, load the schema-design schema and the drill data, and count every table (`count(*)`, exact; `reltuples` and `pg_stat_user_tables` are estimates).
2. `pg_dump --format=custom`: one compressed file, restorable selectively and in parallel. `pg_dump` reads from a single consistent snapshot and does not block writes.
3. Destroy: `DROP DATABASE … WITH (FORCE)`.
4. Create an empty database and `pg_restore --exit-on-error` into it, so the first error stops the restore instead of leaving a half-restored database that looks fine.
5. Count again, compare with [`compareCounts`](./row-counts.ts), print both columns, and exit with 1 on any difference, including a table missing on either side. The drill always drops its database and deletes the dump file at the end.

It also prints how long the backup and the restore took. Row counts prove the rows came back, the restore of the schema (extension, exclusion constraint, triggers, indexes) proves the DDL did; they do not prove the values are identical. For that, compare a checksum per table (`SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM jira_issues AS t`) on both sides.

**What `pg_dump` does not cover.** It dumps one database: no roles, no passwords, no database-level settings (`pg_dumpall --globals-only` for those; on RDS add `--no-role-passwords`). The `pg_dump` version must be at least the server's. Parallel restore (`pg_restore --jobs`) needs a file or directory, not a pipe. On RDS, `pg_dump` complements snapshots (moving data between versions or accounts, extracting a table, archives); it does not replace them.

**How it is proven.** [`restore-drill.test.ts`](./restore-drill.test.ts) runs the drill as a separate process against the container and checks it seeded 5 tables and 1,096 rows, destroyed and restored the database, verified every count, exited with 0 (otherwise the test fails) and dropped its database. Unit tests cover `compareCounts` (matching counts, different counts, tables missing on either side) and `countRows`. The AWS part is a document: the runbook's commands are commented out and are not executed.

## Common mistakes

| Symptom                                                          | Cause                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The restored instance is unreachable from the application        | It was created with the default security group and subnet group. Pass them explicitly.                    |
| The restored instance behaves differently (timeouts, extensions) | It got the default parameter group instead of the production one.                                         |
| "We have backups" but point-in-time recovery is not available    | Retention was set to 0, which disables automated backups.                                                 |
| The rollback point after a failed migration is hours old         | No manual snapshot right before the change; the last automated one was the nightly snapshot.              |
| `pg_restore` finished, but tables are empty or missing           | Errors were ignored. Use `--exit-on-error` and compare row counts.                                        |
| `pg_dump: error: aborting because of server version mismatch`    | A client older than the server. Use the same major version or newer (here, the one inside the container). |
| Users cannot log in after restoring a dump into a new cluster    | `pg_dump` does not include roles. Recreate them with `pg_dumpall --globals-only` or the roles script.     |
| Nobody knows how long a restore takes                            | No drill was ever run. Rehearse and write the measured RTO in the runbook.                                |

## Practice

Extend the drill with a checksum per table (`md5` over the rows ordered by primary key) before and after, and add a test that corrupts one row in the restored database to prove the drill then exits with 1.
