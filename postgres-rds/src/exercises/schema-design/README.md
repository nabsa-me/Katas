# Schema design

## Statement

A service tracks teams, the people in them over time, the initiatives each team owns and the Jira issues synced into those initiatives. Its first version came from a document-database background: one JSONB document per row and nothing else ([`schema.problem.sql`](./schema.problem.sql)):

```sql
CREATE TABLE people (
  id text,
  doc jsonb -- { "email", "displayName", "memberships": [{ "teamId", "role", "from", "to" }] }
);
```

Symptoms after a few months: two people with the same email in different case, memberships pointing to teams that were deleted, a person in the same team twice over the same dates, issues with a status no screen knows about, and initiatives whose owner team no longer exists. Every one of those rows was accepted by the database.

Design the relational schema for `teams`, `people`, `team_memberships` (many-to-many with dates), `initiatives` and `jira_issues` so the database itself rejects invalid data, decide what each foreign key does on delete, add the indexes the real queries need, and keep JSONB only where it earns its place.

## What gets assessed

- Normalizing: one table per entity, a link table for a many-to-many relationship with its own attributes (role, dates).
- Constraints as the last line of defence: `PRIMARY KEY`, `NOT NULL`, `UNIQUE` (including case-insensitive), `CHECK`, `FOREIGN KEY` and an exclusion constraint for overlapping dates.
- A reasoned `ON DELETE` per relationship (`CASCADE`, `RESTRICT`, `SET NULL`), not a default copied everywhere.
- Indexes designed from the queries, including the ones foreign keys need.
- Knowing when JSONB is the right tool, and how relational modelling differs from DynamoDB's access-pattern modelling.

## How to approach it, step by step

1. List the entities and the relationships between them. A person belongs to many teams and a team has many people, over time: that is a link table with `team_id`, `person_id`, `role`, `valid_from`, `valid_to`.
2. For each column, ask "can this ever be missing?" (`NOT NULL`), "can two rows share it?" (`UNIQUE`) and "which values are valid?" (`CHECK`).
3. For each foreign key, ask what deleting the parent should do to the child: delete it too, forbid the delete, or keep the child and clear the reference.
4. Look for rules that span rows, such as "no overlapping memberships". `UNIQUE` cannot express them; an exclusion constraint can.
5. Write down the queries the application runs and design one index per query shape. Then check that every foreign key column is the first column of some index.
6. Prove it: insert invalid rows and assert the SQLSTATE each one fails with.

## Solution explained

[`schema.sql`](./schema.sql) is the solution and [`schema.test.ts`](./schema.test.ts) proves it against a real Postgres: the problem schema accepts every invalid row, the solution rejects each one with the expected SQLSTATE.

**Keys.** Every table has `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`. Identity columns are the SQL-standard replacement for `serial`; `ALWAYS` rejects an application that tries to choose its own ids. Natural identifiers that must be unique but may change (a team slug, an email, a Jira key) get a `UNIQUE` constraint instead of being the primary key, so renaming one never cascades through foreign keys.

**Constraints and the errors they raise.** The tests assert the SQLSTATE, which is what an application maps to a user-facing error:

| Rule                                         | Constraint                                                 | SQLSTATE |
| -------------------------------------------- | ---------------------------------------------------------- | -------- |
| A person has an email                        | `email text NOT NULL`                                      | `23502`  |
| One person per email, whatever the case      | `CREATE UNIQUE INDEX … ON people (lower(email))`           | `23505`  |
| A membership points to an existing team      | `team_id … REFERENCES teams (id)`                          | `23503`  |
| Valid status, key format, dates in order     | `CHECK (status IN (…))`, `CHECK (valid_to > valid_from)`   | `23514`  |
| No overlapping memberships in the same team  | `EXCLUDE USING gist (person_id WITH =, team_id WITH =, …)` | `23P01`  |
| `custom_fields` is an object, never an array | `CHECK (jsonb_typeof(custom_fields) = 'object')`           | `23514`  |

**A `CHECK` passes when it evaluates to `NULL`.** `CHECK (ends_on >= starts_on)` allows an initiative with no end date, because `NULL >= date` is `NULL`, not `false`. That is usually what you want; when it is not, add `NOT NULL`.

**Overlapping dates need an exclusion constraint.** `UNIQUE (person_id, team_id)` would forbid rejoining a team later, and `UNIQUE (person_id, team_id, valid_from)` would allow two overlapping periods with different start dates. The exclusion constraint says "no two rows with equal `person_id`, equal `team_id` and overlapping `daterange(valid_from, valid_to)`". `daterange` is half-open (`[from, to)`), so a membership ending on 1 January and the next one starting on 1 January do not overlap, and a `NULL` end means "still current". The `btree_gist` extension lets a GiST index compare plain `bigint` columns with `=`.

**`ON DELETE`, one decision per relationship.**

- `team_memberships → teams, people`: `CASCADE`. A membership has no meaning without both ends.
- `initiatives → teams`: `RESTRICT`. Deleting a team must not silently delete the work it owns; the application reassigns the initiatives first. The test proves the delete fails with `23503` and succeeds once the initiative is gone.
- `jira_issues → people, initiatives`: `SET NULL`. Issues come from Jira and outlive a person leaving or a local initiative being removed; the issue stays, unassigned.

**Indexes from the queries.** Postgres indexes primary keys and `UNIQUE` constraints automatically, but **not foreign keys**. Without an index on the child column, every delete of a parent row scans the whole child table to check or cascade, and joins from the parent are slow. Each index below serves a real query and, by its first column, a foreign key:

| Query                                         | Index                                                     |
| --------------------------------------------- | --------------------------------------------------------- |
| Team roster on a date (`team_id = $1`, dates) | `team_memberships (team_id, valid_from)`                  |
| A person's teams over time                    | the exclusion constraint's GiST index (`person_id` first) |
| Initiative board: its issues by status        | `jira_issues (initiative_id, status)`                     |
| Someone's open work                           | `jira_issues (assignee_id, status)`                       |
| Initiatives of a team, unique name per team   | `UNIQUE (owner_team_id, name)`                            |
| Issues whose custom fields contain a value    | `GIN (custom_fields jsonb_path_ops)`                      |

The last test runs a catalog query that lists every foreign key whose column is not the first column of an index. It returns nothing for this schema, and the test also adds an unindexed foreign key to show the query catches it. Run the same query in CI against a real schema.

**`updated_at` maintained by the database.** A `BEFORE UPDATE` trigger sets `updated_at = now()` on every update, even when the statement tries to set it to something else, so no code path can forget it. `timestamptz` stores an instant in UTC; plain `timestamp` loses the time zone and is a common source of off-by-hours bugs.

**When JSONB does make sense.** `jira_issues.custom_fields` holds the fields that differ per Jira project (severity, component, customer). They are stored and returned whole, never joined, rarely filtered, and their shape is owned by Jira, not by this schema. A `GIN (custom_fields jsonb_path_ops)` index serves containment filters (`custom_fields @> '{"severity": "high"}'`), and a `CHECK` keeps the column an object. The moment a field is filtered on every request, joined or needs a constraint, it becomes a real column. Other good fits: raw webhook payloads kept for audit, per-tenant settings, and sparse attributes with hundreds of possible keys.

**DynamoDB access-pattern modelling vs relational modelling.**

| Aspect             | DynamoDB (single-table design)                                                                        | Postgres (relational)                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Starting point     | The list of access patterns; the table is shaped to answer each one with a single `Query`             | The entities and their rules; queries are written later, against a normalized model      |
| Relationships      | Pre-joined: items that are read together share a partition key (`TEAM#123` with its `MEMBER#…`)       | Foreign keys and `JOIN` at read time                                                     |
| New access pattern | Often a new GSI, a new composite sort key or a backfill of denormalized attributes                    | Usually a new index or just a new query                                                  |
| Integrity          | In the application: conditional writes and transactions (`TransactWriteItems`) for the rules you code | In the database: `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys, exclusion constraints      |
| Uniqueness         | One unique key per table (`PK`+`SK`); other unique values need extra "lock" items in a transaction    | Any number of `UNIQUE` constraints and indexes, including on expressions                 |
| Ad hoc questions   | Expensive: a `Scan`, or exporting to S3 and querying with Athena                                      | Any SQL query; indexes make the frequent ones fast                                       |
| Scaling            | Horizontal and predictable latency at any size, if partition keys are well distributed                | Vertical plus read replicas; a single writer                                             |
| Pick it when       | Known, stable access patterns at very high scale, key-value or key-range reads, serverless pricing    | Evolving queries, reporting, relationships and invariants that must hold, moderate scale |

The problem schema is what happens when DynamoDB habits move to Postgres without DynamoDB's discipline: no access patterns designed up front and no conditional writes, so neither model's guarantees hold.

## Common mistakes

| Symptom                                                       | Cause                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Deleting a parent row takes seconds and locks the child table | The foreign key column has no index: Postgres creates one for the referenced key, not the referencing one.  |
| `Ada@example.com` and `ada@example.com` both exist            | `UNIQUE (email)` is case-sensitive. Use a unique index on `lower(email)` (or the `citext` type).            |
| A person appears twice in a team for the same month           | Overlap is a rule across rows: `UNIQUE` cannot express it, an exclusion constraint can.                     |
| Deleting a team silently deleted its initiatives and issues   | `ON DELETE CASCADE` copied onto every foreign key. Decide per relationship.                                 |
| A `CHECK (ends_on >= starts_on)` lets a row through           | One side was `NULL`: the check evaluated to `NULL`, which passes. Add `NOT NULL` if the value is required.  |
| Every query reads `doc->>'status'` and nothing is validated   | JSONB used for core, queried fields. Columns for what you query and constrain; JSONB for the variable rest. |

## Practice

Add `jira_issue_links (from_issue_id, to_issue_id, link_type)` with a `CHECK` that forbids an issue linking to itself and a unique constraint that forbids the same link twice, then add tests for both rules.
