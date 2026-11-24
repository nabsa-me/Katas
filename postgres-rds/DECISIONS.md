# Decisions

## Versions

Checked on 2026-11-24.

| Package / tool      | Version  | Verified against                                                                                                                                                     |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL (Docker) | 16.16    | `postgres:16.16-alpine` on Docker Hub (digest `sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d`); `btree_gist` ships in the image            |
| pg                  | 8.23.1   | npm registry; ESM entry `esm/index.mjs` exports `Pool`, `Client`, `DatabaseError`, `escapeIdentifier`, `escapeLiteral`                                               |
| @types/pg           | 8.23.1   | `node_modules/@types/pg/index.d.ts` (`password` accepts `() => string \| Promise<string>`; `maxLifetimeSeconds` in `PoolConfig`)                                     |
| dbmate              | 2.38.2   | npm registry; `node_modules/dbmate/README.md` and `dist/index.d.ts` (`resolveBinary()`); `@dbmate/win32-x64` runs on Windows                                         |
| @aws-sdk/rds-signer | 3.1176.0 | `node_modules/@aws-sdk/rds-signer/dist-types/Signer.d.ts` (`new Signer({ hostname, port, username, region, credentials }).getAuthToken()`, 900 s)                    |
| typescript          | 6.0.3    | npm registry (same minor as the root tooling)                                                                                                                        |
| vitest              | 5.1.1    | npm registry                                                                                                                                                         |
| tsx                 | 4.23.15  | npm registry                                                                                                                                                         |
| @types/node         | 24.19.2  | npm registry                                                                                                                                                         |
| AWS CLI commands    | v2       | https://docs.aws.amazon.com/cli/latest/reference/rds/ (`restore-db-instance-to-point-in-time`, `restore-db-instance-from-db-snapshot`, `wait`, `modify-db-instance`) |

## Decisions

- **dbmate for migrations.** Plain SQL files with `-- migrate:up` / `-- migrate:down`, a transaction per migration and `transaction:false` where Postgres forbids one (`CREATE INDEX CONCURRENTLY`). The reviewer reads exactly what runs, and the same files run locally, in CI and against RDS. The npm package's Windows binary works, so the node-pg-migrate fallback was not needed. The package has no JavaScript API beyond `resolveBinary()`, so `migrations.ts` runs the binary with `execFile`.
- **dbmate file names keep a numeric version** (`20261124090000_create_people.sql`). dbmate orders and records migrations by that prefix, so it is the one exception to descriptive-only names; the part after the version is descriptive.
- **"Deploy release N" = `dbmate up` on a directory with the first N files.** dbmate has no target-version option for `up`, and this is also how a release ships its migrations.
- **The flawed migrations are in dbmate's format too**, because a reviewer would see them as migrations. The tests run their `-- migrate:up` section with a `pg` client (`upSection`), which gives the lock demonstrations control over timing; the real series always runs through the dbmate binary.
- **Lock behaviour reproduced with an open transaction and `lock_timeout`, not a huge table.** A transaction that wrote to `people` stays open, the index migration queues, and the application's insert with a 300 ms `lock_timeout` either fails with `55P03` (plain `CREATE INDEX`) or succeeds (`CONCURRENTLY`). Deterministic and fast, and it is the real failure mode (lock queues), not just "a long build".
- **`SET NOT NULL` skipping the scan is proven with Postgres's own `DEBUG1` messages** (`client_min_messages = debug1`): "existing constraints … are sufficient to prove that it does not contain nulls" versus "verifying table".
- **The contract migration's down section raises an exception on purpose**: the dropped column's data cannot come back from a migration; the way back is rolling forward or restoring the snapshot.
- **One temporary database per test file** (`<prefix>_<random suffix>`, `DROP DATABASE … WITH (FORCE)` afterwards), so files run in parallel. A Vitest `globalSetup` checks the connection first and fails with `Start Postgres first: docker compose up -d --wait`.
- **Roles are cluster-wide, so the least-privilege test suffixes every role name** in `roles.sql` and `app-schema.sql` (a whole-word replacement of the eight names) and drops the roles after the database. The SQL files stay readable with plain names.
- **`ALTER ROLE deployer SET role = 'migrator'`** so objects created by the pipeline belong to `migrator` and `ALTER DEFAULT PRIVILEGES FOR ROLE migrator` applies to them. **`GRANT migrator TO CURRENT_USER`** because on RDS the master user is `rds_superuser`, not a superuser, and Postgres 16 requires being able to `SET ROLE` to a role to hand it ownership (https://www.postgresql.org/docs/16/sql-alterschema.html). The BI schema is called `reports` so it never clashes with the `reporting` role.
- **IAM tokens are signed locally with fake static credentials** (`replace-with-…`). Signing is a presigned URL and needs no network; `GRANT rds_iam` and the `rds-db:connect` policy cannot run locally and are explained in the README.
- **Query plans are never forced.** No `enable_seqscan = off`: the seed runs `VACUUM ANALYZE`, and the tests assert node types, index names, actual rows and buffer counts, which are deterministic for the same data, instead of timings. `npm run explain` prints the timings for reading, not for asserting.
- **Deterministic seed with `generate_series` and `hashint4`**, so status does not follow the team and every run plans the same way. `created_at` is `timestamptz(3)` so keyset cursors round-trip exactly through a JavaScript `Date`.
- **Pooling has no `.problem` file**: the flaw is configuration (defaults, sizing), so the exercise gives a tested sizing function and a commented pool instead.
- **The restore drill runs `pg_dump` and `pg_restore` inside the container** (`docker compose -f <kata>/docker-compose.yml exec -T postgres …`), so nothing needs installing on the host and the client version always matches the server. It restores the schema-design schema with fictional data, so extensions, exclusion constraints and triggers are part of the drill.
- **Compose keeps the data directory in `tmpfs`** and the healthcheck uses `pg_isready -h 127.0.0.1` (TCP). Every test creates its own database, so nothing needs to persist, `docker compose down` leaves no volume behind, and the TCP check does not report ready while the image's init server (socket only) is still running.
- **No `src/data/`.** Each exercise's fictional data is SQL next to the exercise (`seed.sql`, `drill-data.sql`) or inserted by its tests, because it is generated with `generate_series` and belongs to that exercise's schema.
- **Extra scripts**: `explain` (query-performance) and `restore-drill` (backups-and-restore), both run with `tsx`.
- **Port 5807** on the host, mapped to the container's 5432; `DATABASE_ADMIN_URL` overrides the admin connection (for example in CI).

## Not verified

None.
