# dbt basics

## Statement

The extractor lands Jira issues in `raw.jira_issues` every night. Reports query that table directly, each with its own SQL:

```sql
-- One of several "throughput" queries in circulation
SELECT project_key, date_trunc('week', updated_at), count(*)
FROM raw.jira_issues WHERE status = 'Done' GROUP BY 1, 2;
```

Each report maps projects to teams with its own copy of a spreadsheet, nobody knows whether the data is from last night or last week, and a project that no team owns simply disappears from every chart. Build a dbt project on the local Postgres that turns the raw table into one tested mart, **issue throughput per team per week**: a source with freshness, staging, intermediate and mart models, and `unique`, `not_null`, `relationships` and `accepted_values` tests. Then explain what a semantic layer would add on top, and where Cube fits.

## What gets assessed

- The anatomy of a dbt project: profile, `source()` and `ref()`, seeds, materializations, one schema per layer.
- Layering: staging cleans, intermediate holds the business rule, the mart is what consumers read.
- Data tests (generic and singular) and how `dbt build` stops everything downstream of a failure.
- Source freshness as a check on the pipeline, not on the data.
- What a semantic layer is (MetricFlow, Cube) and what it adds over a well-tested mart.

## How to approach it, step by step

1. Load the fictional issues into `raw.jira_issues` and run `dbt debug` until the profile connects.
2. Declare the source with its freshness rule, and add a staging model that only renames, casts and normalizes values.
3. Put the reference data (teams, which team owns which project) in seeds, with their own tests.
4. Write the definition of throughput once, in an intermediate model: which issues count, which date, which week, which team.
5. Aggregate it in the mart, materialized as a table, with an enforced contract.
6. Add tests where a wrong value would silently change the metric: keys, accepted statuses, the project-to-team relationship, one row per team and week.
7. Run `dbt build` and `dbt source freshness`; break the data on purpose and watch what gets skipped.
8. Write down which questions the mart cannot answer without new SQL; that is where a semantic layer starts.

## Solution explained

The project is in this folder: [`dbt_project.yml`](./dbt_project.yml), [`profiles.yml`](./profiles.yml), [`seeds/`](./seeds), [`models/`](./models) and [`tests/`](./tests). [`load_raw_issues.py`](./load_raw_issues.py) lands the fictional issues with the extractor's own [`storage.py`](../incremental_jira_extractor/storage.py), so `raw.jira_issues` has exactly the shape a nightly run produces. [`dbt_runner.py`](./dbt_runner.py) runs the dbt CLI as a subprocess against a chosen database, and [`test_dbt_project.py`](./test_dbt_project.py) proves the project.

**Profile and connection.** [`profiles.yml`](./profiles.yml) reads the standard libpq variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) with `env_var()` and defaults to the kata's Postgres on port 5810, so the same file works locally, in tests (which point `PGDATABASE` at a temporary database) and in CI. Custom variables must not start with `DBT_`: dbt 1.12 reserves that prefix and warns about unknown `DBT_…` variables. The project sets `send_anonymous_usage_stats: false` under `flags:`, so nothing is sent from a kata and no `.user.yml` appears next to the profile.

**One schema per layer.** `+schema: staging` (and `intermediate`, `marts`, `seeds`) in `dbt_project.yml` puts each layer in its own schema. dbt's default `generate_schema_name` **appends** the custom schema to the target's: the mart lands in `analytics_marts`, not `marts`. Separate schemas let you grant consumers `SELECT` on the marts only, so nobody builds a dashboard on a staging view.

**Source and freshness.** [`_jira__sources.yml`](./models/staging/_jira__sources.yml) declares `raw.jira_issues` as the `jira` source. In dbt 1.12, `loaded_at_field` and `freshness` go under `config:` (as top-level properties they trigger a deprecation warning):

```yaml
config:
  loaded_at_field: loaded_at
  freshness:
    warn_after: { count: 24, period: hour }
    error_after: { count: 48, period: hour }
```

`dbt source freshness` compares `max(loaded_at)` with the current time: a warning after a missed night, an error (exit code 1) after two. It checks the **pipeline** (did the extractor write anything?), which is why it uses `loaded_at` and not Jira's `updated`. `dbt build` does not run it: the nightly job runs `dbt source freshness` first and only builds if it passes.

**Seeds for reference data.** [`teams.csv`](./seeds/teams.csv) and [`team_projects.csv`](./seeds/team_projects.csv) are small, reviewed in pull requests and versioned with the models that use them. Seeds are for that kind of data (mappings, codes, a few hundred rows), not for loading facts.

**Staging cleans, nothing else.** [`stg_jira__issues`](./models/staging/stg_jira__issues.sql) is one view per source table: it selects, renames and normalizes (`lower(status_category)`, `upper(project_key)`), with no joins and no rules. Every later model reads `ref('stg_jira__issues')`, never the raw table, so a change in the source is absorbed in one place.

**The definition lives in one model.** [`int_resolved_issues_by_team`](./models/intermediate/int_resolved_issues_by_team.sql) is where "throughput" is decided:

```sql
cast(date_trunc('week', issues.resolved_at at time zone 'UTC') as date) as week_start
...
where issues.status_category = 'done' and issues.resolved_at is not null
```

An issue counts once, when its status **category** is done (so `Done`, `Closed` and any future done status all count), in the ISO week (Postgres's `date_trunc('week')` starts on Monday) of its **resolution date** in UTC, for the team that owns its project. Every one of those words is a choice that ad-hoc queries make differently, which is the next exercise's subject.

**The mart, with a contract.** [`fct_team_weekly_throughput`](./models/marts/fct_team_weekly_throughput.sql) is a table: one row per team and week with at least one resolved issue. [`_marts_models.yml`](./models/marts/_marts_models.yml) enforces a contract: dbt checks the query's column names and types against the declared ones **before** building, and creates the table with `NOT NULL` and `CHECK (resolved_issues > 0)` constraints. Renaming a column or turning `integer` into `bigint` fails the build instead of the dashboards that read it. `+persist_docs: { relation: true }` writes the model's description to the table as a Postgres comment, so the definition travels with the numbers (the next exercise's API serves it from there).

**Tests where a wrong value changes the metric.** 21 data tests run with the models:

| Test                                                                          | What it protects                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `unique`, `not_null` on `issue_key` (source, staging, intermediate)           | An issue counted twice, or a row that cannot be traced                  |
| `accepted_values` on `status_category`                                        | A new category (`new`, `indeterminate`, `done` only) silently ignored   |
| `relationships` from `project_key` to `team_projects`                         | A project no team owns disappearing from every team's numbers           |
| `relationships` from `team_id` to `teams` (seed and intermediate)             | A mapping that points to a team that does not exist                     |
| `not_null` on `resolved_at` **where** `status_category = 'done'`              | A workflow that closes issues without a resolution date (never counted) |
| Singular [`one_row_per_team_and_week`](./tests/one_row_per_team_and_week.sql) | A duplicated team and week doubling a team's throughput                 |

In dbt 1.12, a generic test's parameters go under `arguments:` (`relationships: { arguments: { to: ref('teams'), field: team_id } }`), and test settings such as `where` go under `config:`. A singular test is a `SELECT` in `tests/` that returns the offending rows: zero rows is a pass.

**`dbt build` stops at the first broken layer.** `dbt build` runs seeds, models and tests in dependency order, each test right after the node it checks. When a test fails, everything downstream is **skipped**: the mart keeps yesterday's data instead of being rebuilt from bad data. The test proves it by inserting an issue from a project no team owns: the `relationships` test fails, the build exits 1, and the mart is never created.

**How it is proven.** [`test_dbt_project.py`](./test_dbt_project.py) loads the fictional issues into a temporary database and runs `dbt build` once per session: `PASS=26 WARN=0 ERROR=0 SKIP=0` with no deprecation warnings; the mart matches the 12 rows worked out by hand from the sample data; `information_schema` and `pg_constraint` show the contract's types and constraints, and the table's comment holds the definition; loading the sample again writes nothing; `dbt source freshness` passes right after a load. In a second database, an orphan project fails the build before the mart, and `loaded_at` three days old fails freshness with exit code 1.

**What a semantic layer adds.** The mart answers one question at one grain: throughput per team per week. Per month, per issue type, or "throughput divided by open issues" needs new SQL, and every new query is a new chance to redefine the metric. A semantic layer moves the definitions one level up: **entities** (issue, team), **dimensions** (resolution week, issue type), **measures** (count of resolved issues) and **metrics** built from them are declared once, as code, and an API turns "throughput by team by month" into SQL against the marts. Every consumer (BI tool, notebook, application, an AI assistant) asks the API and gets the same number, with caching and access control in one place.

- **dbt Semantic Layer / MetricFlow**: semantic models and metrics are YAML in the same dbt project, next to the marts they describe; MetricFlow compiles metric queries into SQL, and dbt's APIs serve them to connected tools.
- **Cube**: a separate semantic layer that sits between the warehouse (and the dbt marts) and the consumers. Its data model defines cubes with measures, dimensions and joins; it serves them through REST, GraphQL and SQL APIs, and caches results with pre-aggregations.

Either way dbt keeps doing what this exercise does (clean, model, test); the semantic layer only adds governed definitions and an API on top. ⚠️ Verify the current product details (supported APIs, licensing and hosting options) in the [dbt Semantic Layer documentation](https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl) and the [Cube documentation](https://cube.dev/docs). The next exercise builds a tiny version of that API by hand.

## Common mistakes

| Symptom                                                | Cause                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| The mart is in `analytics_marts`, not `marts`          | dbt's default `generate_schema_name` appends the custom schema; override the macro to change it.  |
| Deprecation warnings after upgrading dbt               | Test parameters at the top level instead of under `arguments:`, or `freshness` outside `config:`. |
| A warning about an environment variable in the profile | A custom variable named `DBT_…`: that prefix is reserved for dbt's own settings.                  |
| Every test passes and the dashboard is empty           | `unique` and `not_null` pass on zero rows; freshness or a row count check would have failed.      |
| Stale data, green builds                               | `dbt source freshness` never runs: `dbt build` does not include it.                               |
| A team's throughput drops when a project is created    | Inner join on a mapping without a `relationships` test: the new project's issues vanish.          |
| Business rules scattered across staging models         | Staging should only clean; rules belong in one intermediate model that everything else reuses.    |
| A dashboard breaks after a "harmless" refactor         | No contract on the mart: a renamed or retyped column reaches consumers.                           |
| Seeds used to load a large or fast-changing table      | Seeds are for small reference data in version control; facts arrive through sources.              |

## Practice

Add a week spine (`generate_series` over the weeks between the first and last resolution) so that weeks in which a team resolved nothing appear with `0`, and add a test that every team has a row for every week.
