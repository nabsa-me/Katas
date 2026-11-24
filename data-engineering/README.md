# data-engineering

Three katas on data engineering around Jira data, solved and explained: an incremental, idempotent extractor that lands issues in Postgres, a dbt project that turns them into one tested metric, and an application that consumes that metric instead of computing it. Everything runs locally against Postgres 16 in Docker; Jira is faked with respx in the tests, and the flawed extractor and the flawed dashboard sit next to the fixed ones, with tests that prove the difference.

## Run

Requires Docker and [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 if it is missing).

```bash
cd data-engineering
docker compose up -d --wait   # Postgres 16 on localhost:5810, data in memory
uv sync                       # virtual environment with the runtime, dev and dbt dependencies
uv run pytest                 # every exercise (a temporary database per session; runs dbt build once)
uv run ruff check             # lint
uv run ruff format --check    # formatting
uv run python -m exercises.dbt_basics.load_raw_issues   # land the fictional issues in raw.jira_issues
uv run dbt build --project-dir src/exercises/dbt_basics --profiles-dir src/exercises/dbt_basics   # seeds, models, tests
uv run dbt source freshness --project-dir src/exercises/dbt_basics --profiles-dir src/exercises/dbt_basics   # is the load recent?
uv run python -m exercises.thin_client_governed_data.dashboard payments   # the dashboard, reading the governed metric
docker compose down           # stop Postgres; nothing is kept
```

The extractor also has an optional real mode against a Jira Cloud site: copy `.env.example` to `.env`, replace every value and run `uv run --env-file .env python -m exercises.incremental_jira_extractor.extractor`. The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                                             | What it practises                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [Incremental, idempotent Jira extractor](src/exercises/incremental_jira_extractor/README.md)         | Watermark with an overlap, forward-only upserts, a transaction per batch, `Retry-After` retries, quality gates, exit codes, JSON logs |
| [dbt basics](src/exercises/dbt_basics/README.md)                                                     | Sources and freshness, staging, intermediate and marts, seeds, generic and singular tests, contracts, semantic layer, Cube            |
| [App as a thin client of the governed data layer](src/exercises/thin_client_governed_data/README.md) | One definition per metric, a read-only metrics API, validation at the boundary, `httpx.WSGITransport`                                 |

## Pipeline cheat sheet

| I need…                                      | Use                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| To read only what changed since the last run | A watermark table written after a successful run, and `updated >= "-<minutes>m"` with an overlap           |
| Reruns that never duplicate rows             | A primary key and `INSERT … ON CONFLICT (key) DO UPDATE … WHERE target.updated_at < EXCLUDED.updated_at`   |
| A failure that leaves no half-written batch  | Autocommit connection, and `with connection.transaction():` around each page                               |
| Retries that respect the API                 | tenacity `Retrying` with `stop_after_attempt`, `wait_exponential_jitter`, and `Retry-After` as the minimum |
| To stop bad data before it is loaded         | Checks per batch (nulls in key fields) and after the load (counts, freshness), before the watermark moves  |
| A scheduler that knows what happened         | Distinct exit codes: 0 ok, 1 unexpected error, 2 data quality failure, 3 source unavailable                |
| Logs that can be filtered by run             | structlog JSON lines and `structlog.contextvars.bound_contextvars(run_id=…)`                               |
| Settings that fail fast                      | A pydantic model validated once at startup, listing every bad variable; secrets as `SecretStr`             |
| A fake HTTP API in Python tests              | respx: `respx.mock(base_url=…)`, then `route.mock(side_effect=fake)` or `route.respond(json=…)`            |
| To call a WSGI application without a server  | `httpx.Client(transport=httpx.WSGITransport(app=app), base_url="http://test")`                             |

## dbt cheat sheet

| I need…                                      | Use                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| To check that the profile connects           | `dbt debug` (with `--project-dir` and `--profiles-dir`)                                                         |
| Seeds, models and tests in dependency order  | `dbt build`: a failed test skips everything downstream                                                          |
| One model and everything it depends on       | `dbt build --select +fct_team_weekly_throughput`                                                                |
| To know whether the load is recent           | `dbt source freshness`, with `loaded_at_field` and `freshness` under the source's `config:`                     |
| Small reference data kept in the repository  | A seed (`seeds/*.csv`), loaded by `dbt seed` or `dbt build`                                                     |
| A rule checked on every build                | Generic tests in YAML (`unique`, `not_null`, `relationships`, `accepted_values`), parameters under `arguments:` |
| A rule no generic test expresses             | A singular test: a `SELECT` in `tests/` that returns the offending rows                                         |
| Column names and types consumers can rely on | `contract: { enforced: true }`, with `data_type` and `constraints` on each column                               |
| The definition stored with the table         | `+persist_docs: { relation: true }`: the model's description becomes the table comment                          |
| The SQL dbt actually runs                    | `dbt compile --select <model>`, then `target/compiled/…`                                                        |

## Data

`src/data/jira_issues.json` holds 31 **fictional** Jira issues (projects `PAY`, `WAL`, `PLT` and `MOB`; summaries, people and dates are made up) in the shape Jira's search endpoint returns: dates with timezone offsets, `Closed` as well as `Done`, and an issue updated long after it was resolved. The dbt seeds `teams.csv` and `team_projects.csv` are fictional too.
