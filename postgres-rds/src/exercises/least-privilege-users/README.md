# Least-privilege users

## Statement

The issues service connects to its RDS Postgres database with the master user, the one created with the instance ([`app-pool.problem.ts`](./app-pool.problem.ts)):

```ts
export function createAppPool(masterConnectionString: string): Pool {
  return new Pool({ connectionString: masterConnectionString });
}
```

The migrations, the API, a support dashboard and the BI tool all share that user. Symptom: a cleanup job with a wrong `WHERE` ran a `TRUNCATE` instead of a `DELETE`, a SQL injection in a search endpoint could have dropped any table, and nobody can say which workload holds which credential or revoke one without breaking the others.

Design the roles so each workload can do exactly what it needs: the deploy pipeline runs DDL, the API reads and writes rows, read-only tools only read, and the BI tool only sees the report views. New tables must be usable without anyone remembering a `GRANT`, and the application must refuse to start if it is given an over-privileged user. Explain how the API would authenticate with IAM instead of a password, and how credentials rotate.

## What gets assessed

- Group roles that hold privileges (`NOLOGIN`) and login users that inherit from them.
- Closing what `PUBLIC` gets by default (database `CONNECT`, schema `CREATE`, function `EXECUTE`) and making one role own the schema.
- `ALTER DEFAULT PRIVILEGES` and why it depends on **who** creates the object.
- Reporting through views that run with their owner's privileges.
- RDS specifics: the master user is `rds_superuser`, not a superuser; IAM authentication with `rds_iam` and short-lived tokens; credential rotation with Secrets Manager.

## How to approach it, step by step

1. List the workloads and what each needs: DDL, read and write rows, read rows, read aggregates.
2. Create one `NOLOGIN` group role per capability, and one `LOGIN` user per workload that is a member of exactly one group.
3. Revoke what `PUBLIC` has: `CONNECT` on the database, everything on schema `public`. Grant back only to the groups.
4. Make the DDL role own the schema, and make sure the objects the pipeline creates are owned by that role, not by the login user.
5. Set default privileges for that owner, so every future table is readable or writable by the right groups.
6. Put the BI aggregates in their own schema as views, and grant only that schema.
7. Add a startup check in the application that fails if its user is a superuser, owns tables or can create objects.
8. Prove it: connect as each user and assert which statements fail with `42501` (insufficient privilege).

## Solution explained

[`roles.sql`](./roles.sql) creates the roles and privileges; [`app-schema.sql`](./app-schema.sql) is the application's schema, deployed by the pipeline user; [`app-pool.ts`](./app-pool.ts) is the application's connection with its startup check; [`rds-iam-token.ts`](./rds-iam-token.ts) builds IAM-authenticated pool settings.

**The roles.**

| Role                                       | Logs in | Can                                                          | Cannot                                 |
| ------------------------------------------ | ------- | ------------------------------------------------------------ | -------------------------------------- |
| `migrator`                                 | No      | Own the schemas and tables, run DDL                          | (used only by the pipeline)            |
| `app_rw`                                   | No      | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on application tables | DDL, `TRUNCATE`, create schemas        |
| `app_ro`                                   | No      | `SELECT` on application tables                               | Any write                              |
| `reporting`                                | No      | `SELECT` on the views in `reports`                           | Read the tables, even through `public` |
| `deployer`                                 | Yes     | Everything `migrator` can (member of it)                     | Create roles or databases              |
| `issues_api`, `issues_viewer`, `bi_reader` | Yes     | What their group can                                         | Anything else                          |

Privileges are granted to groups, never to login users. Rotating or revoking one workload's credential touches one login user, and adding a second API service is one `CREATE ROLE … LOGIN IN ROLE app_rw`.

**Closing `PUBLIC`.** Every role is a member of `PUBLIC`, which by default has `CONNECT` and `TEMPORARY` on every new database, `EXECUTE` on new functions and, in databases created before Postgres 15, `CREATE` on schema `public`. `roles.sql` revokes all of it and grants `CONNECT` back to the four groups only. The test creates a login user in no group and shows it cannot even connect (`42501`).

**Who owns the objects decides the default privileges.** `ALTER DEFAULT PRIVILEGES FOR ROLE migrator …` only applies to objects that `migrator` itself creates, from then on. If `deployer` ran `CREATE TABLE` as itself, the table would belong to `deployer` and no default privilege would apply: the application would get `permission denied` on the first new table after a deploy. `ALTER ROLE deployer SET role = 'migrator'` makes every `deployer` session start as `migrator`, so everything the pipeline creates is owned by `migrator`. The test creates a table as `deployer`, checks its owner is `migrator`, and uses it at once as `issues_api` and `issues_viewer`. `GRANT … ON ALL TABLES IN SCHEMA` is the other half: it covers the tables that already exist when you introduce the roles.

**Sequences.** `serial` columns need `USAGE` on their sequence, hence the default privilege on sequences for `app_rw`. Identity columns (`GENERATED … AS IDENTITY`) need no grant of their own: the `INSERT` privilege is enough.

**Reporting through views.** A view reads its tables with the privileges of the view's owner (unless it is created `WITH (security_invoker = true)`, Postgres 15+). `reports.open_issues_per_team` is owned by `migrator`, so `bi_reader` can read the aggregate while `SELECT * FROM public.jira_issues` fails with `42501`. BI gets exactly the shape you publish, and the tables can change behind the view.

**The application checks its own user.** [`createAppPool`](./app-pool.ts) reads `pg_roles` and the catalog at startup and refuses to start if its user is a superuser, a member of `rds_superuser`, can create roles or databases, bypasses row-level security, owns tables (directly or through a role it inherits) or can create objects in `public`. A secret that points at the master user, or at the pipeline's user, fails the deploy instead of running unnoticed. The test shows it rejecting `postgres` ("is a superuser") and `deployer` ("owns tables, so it can alter or drop them, can create objects in schema public"), and accepting `issues_api`.

**On RDS.** The master user is not a superuser: it is a member of `rds_superuser`, which can create roles and grant almost everything. In Postgres 16, a role can hand ownership to another role (`ALTER SCHEMA … OWNER TO migrator`, `CREATE SCHEMA … AUTHORIZATION migrator`) only if it can `SET ROLE` to it, hence `GRANT migrator TO CURRENT_USER` in `roles.sql`. Locally the master is a superuser and the grant is harmless. Keep the master credential for emergencies; on RDS it can be a managed secret (`rds!db-…` in Secrets Manager, rotated every 7 days by default).

**IAM authentication instead of a password.** On RDS, `GRANT rds_iam TO issues_api;` makes the user sign in with an IAM token instead of its password. The workload's IAM role needs a policy like:

```json
{
  "Effect": "Allow",
  "Action": "rds-db:connect",
  "Resource": "arn:aws:rds-db:eu-west-1:123456789012:dbuser:db-ABCDEFGHIJKLMNOP/issues_api"
}
```

(`db-…` is the instance's `DbiResourceId`; for RDS Proxy, the proxy's `prx-…` id.) A token is a presigned URL for the `rds-db:connect` action, signed with the workload's AWS credentials, valid for 15 minutes and only needed to open a connection: open connections are not closed when it expires. TLS is required. [`rds-iam-token.ts`](./rds-iam-token.ts) creates the `Signer` from `@aws-sdk/rds-signer` and passes `password: () => signer.getAuthToken()` to `pg`, which calls the function for every new connection, so a long-lived pool always signs a fresh token. [`rds-iam-token.test.ts`](./rds-iam-token.test.ts) signs a token locally with fake static credentials and checks `Action=connect`, `DBUser=issues_api`, `X-Amz-Expires=900` and the credential scope (`…/eu-west-1/rds-db/aws4_request`); nothing is sent to AWS.

**Rotation with Secrets Manager.** When a workload uses a password, it lives in Secrets Manager and the application reads it at startup (and again when a new connection fails to authenticate). Secrets Manager's rotation function offers two strategies: single user (it changes the password of one user; open connections are not dropped, and there is a short window where a new connection can be denied, so retry) and alternating users (it clones the user and alternates which one it updates, so the current secret always holds valid credentials; it needs a second secret with credentials that can clone users). The clone is created with the original user's privileges, which is one more reason to grant privileges to groups, not to login users.

**How it is proven.** [`least-privilege.test.ts`](./least-privilege.test.ts) runs `roles.sql` as the master user, deploys the schema as `deployer` and connects as each user. Each forbidden statement fails with `42501`: `issues_viewer` cannot insert, update or delete; `issues_api` cannot `CREATE`, `ALTER`, `DROP` or `TRUNCATE`; `bi_reader` cannot read the tables; a user in no group cannot connect. The problem test shows that the master user's pool can drop the issues table and create a superuser (inside a transaction that is rolled back). Roles are cluster-wide, so the test suffixes every role name and drops them afterwards.

## Common mistakes

| Symptom                                                          | Cause                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `permission denied for table …` right after a deploy             | The new table is owned by the login user that ran the migration, so default privileges for the group owner did not apply. |
| Default privileges were set but new tables are still not granted | `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` applies to the role that ran it, not to the one that creates tables.        |
| Existing tables are not readable after introducing the roles     | Default privileges only cover future objects. Run `GRANT … ON ALL TABLES IN SCHEMA` once.                                 |
| `permission denied for sequence …_id_seq` on insert              | A `serial` column and no `USAGE` on its sequence. Grant it, or use identity columns.                                      |
| Every role can connect to every database                         | `PUBLIC` keeps `CONNECT` on new databases. Revoke it and grant it to the groups.                                          |
| Revoking one service's access breaks another                     | Several workloads share one login user. One user per workload, privileges on groups.                                      |
| IAM authentication fails with a valid token                      | No TLS, the user lacks `rds_iam`, or the policy's resource uses the instance name instead of `DbiResourceId`.             |

## Practice

Add row-level security to `jira_issues` so `issues_viewer` only sees the issues of the teams in a session setting (`current_setting('app.team_ids')`), and add tests for a team's issues being visible and another team's being hidden.
