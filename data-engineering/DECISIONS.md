# Decisions

## Versions

Checked on 2026-11-24.

| Package / tool         | Version | Verified against                                                                                                                                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python                 | 3.12.16 | uv-managed CPython; `.python-version` = `3.12`, `requires-python = ">=3.12"`                                                                                                                |
| uv, uv_build           | 0.13.9  | `uv --version`; `uv sync` installs the project editable (`data_engineering.pth` points at `src`)                                                                                            |
| PostgreSQL (Docker)    | 16.16   | `postgres:16.16-alpine` on Docker Hub (digest `sha256:f2f98726820d0342055351c6e9d36e705f5bfffb3dd53ff556325114b08afb6d`)                                                                    |
| httpx                  | 0.28.1  | PyPI; `httpx.WSGITransport(app, raise_app_exceptions, script_name, remote_addr, wsgi_errors)` in the installed package                                                                      |
| tenacity               | 9.2.1   | PyPI; `Retrying(stop, wait, retry, sleep, before_sleep)`, `wait_exponential_jitter`, `RetryError.last_attempt` in the installed package                                                     |
| psycopg[binary]        | 3.3.9   | PyPI; `connection.transaction()`, `executemany` in pipeline mode, `psycopg.errors.ReadOnlySqlTransaction`                                                                                   |
| pydantic               | 2.14.4  | PyPI; `AliasPath`, `SecretStr`, `HttpUrl`, `model_validate_json`                                                                                                                            |
| structlog              | 26.1.0  | PyPI; `contextvars.bound_contextvars`, `testing.capture_logs`, `processors.JSONRenderer`                                                                                                    |
| pytest                 | 9.2.0   | PyPI                                                                                                                                                                                        |
| respx                  | 0.23.1  | PyPI; `respx.mock(base_url=…, assert_all_mocked=…)`, `route.mock(side_effect=…)`, `params` pattern                                                                                          |
| ruff                   | 0.17.6  | PyPI (`uv.lock`)                                                                                                                                                                            |
| dbt-core               | 1.12.7  | PyPI; YAML rules in the installed `dbt/deprecations.py` (`PropertyMovedToConfigDeprecation`, `MissingArgumentsPropertyInGenericTestDeprecation`, `EnvironmentVariableNamespaceDeprecation`) |
| dbt-postgres           | 1.11.0  | PyPI; depends on `psycopg2-binary` (2.9.13 in `uv.lock`)                                                                                                                                    |
| Jira Cloud REST API v3 | —       | `POST /rest/api/3/search/jql` with `nextPageToken` and `isLast`: https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json                                                     |
| Jira rate limiting     | —       | 429 and some 503 with `Retry-After` in seconds: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/                                                                          |

## Decisions

- **A uv project at the kata root, no `package.json`.** `pyproject.toml`, `uv.lock` and `.python-version`; runtime dependencies plus two dependency groups, `dev` (pytest, respx, ruff) and `dbt` (dbt-core, dbt-postgres), both installed by default (`default-groups`). Ruff uses a line length of 120 to match the repository's Prettier `printWidth`.
- **`uv_build` as the build backend** with `module-root = "src"` and the packages `exercises` and `lib`: `uv sync` installs them in editable mode, so `uv run python -m exercises.…` works from the kata folder, and pytest finds them through `pythonpath = ["src"]`.
- **snake_case exercise folders** (`incremental_jira_extractor`, `dbt_basics`, `thin_client_governed_data`) instead of the repository's kebab-case, because they are Python packages and Python imports need valid identifiers. Tests are colocated as `test_<module>.py`.
- **Flawed versions as `<name>.problem.py`.** The dot keeps the repository's naming convention but makes the file impossible to `import`, so the tests load it by path with `lib/problem_module.py`.
- **Relative JQL bound.** Later runs search `updated >= "-<minutes>m"`, with the minutes computed at run time from the watermark plus a 15-minute overlap, instead of an absolute date that Jira would read in the searching user's timezone. The timezone sentence is under "Not verified".
- **Watermark = start of the last successful run**, stored in `etl_watermarks` and written only after every page and every post-load check has passed; each page is upserted in its own transaction on an autocommit connection, and the upsert only replaces a row with a newer `updated`.
- **Time, sleep and backoff are injected.** `run()` takes `now`, and `JiraClient` takes `sleep` and the tenacity wait strategy, so the tests assert the exact delays (`Retry-After` as the minimum, exponential backoff, give-up after 5 attempts) without waiting.
- **Exit codes** 0 (ok), 1 (unexpected error or bad configuration), 2 (data quality failure), 3 (source unavailable after retries), so a scheduler can retry 3 automatically and page someone for 1 and 2.
- **structlog with contextvars.** `main()` binds `run_id` and `source` with `bound_contextvars`, so every JSON line of a run carries them, including the retry warnings logged inside the client. Tests read events with `capture_logs()`; one test checks the real JSON output and that the token never appears.
- **A fake Jira for respx** (`fake_jira.py`): pages of 10 issues sorted by `updated`, the relative `updated` bound honored, and scripted failures per page. It does not filter by project, so the thin-client test has its own small fake that honors `project in (…)`.
- **One temporary database per test session** (`data_engineering_<suffix>`, dropped with `WITH (FORCE)`), one schema per extractor test, and a second database for the dbt failure cases, so the session's warehouse stays correct for the tests that read it. The `database_url` fixture stops the run with `Start Postgres first: docker compose up -d --wait` when Postgres does not answer.
- **`dbt build` once per session** (`dbt_build` fixture in `src/conftest.py`), as the nightly job would run it; the dbt and thin-client tests read the warehouse it builds.
- **dbt runs as a subprocess** with the `dbt` executable of the running virtual environment (never another one on the `PATH`), `DBT_USE_COLORS=false` and `PYTHONUTF8=1` so the output is plain UTF-8 on a Windows console too. Tests assert on dbt's summary line and exit code, as CI would.
- **The dbt profile reads the standard libpq variables** (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) with local defaults, because dbt 1.12 reserves the `DBT_` prefix and warns about unknown `DBT_…` variables. `send_anonymous_usage_stats: false` under `flags:`.
- **dbt 1.12 YAML.** `loaded_at_field` and `freshness` under the source's `config:`, generic test parameters under `arguments:`, test settings such as `where` under `config:`. Checked in the installed package before writing the models; the build test asserts there is no deprecation warning.
- **One schema per layer** (`analytics_staging`, `analytics_intermediate`, `analytics_marts`, `analytics_seeds`) with dbt's default `generate_schema_name`, which appends the custom schema to the target's.
- **The mart has an enforced contract and `persist_docs`.** The contract fixes names, types, `NOT NULL` and a `CHECK`; `persist_docs` stores the model description as the table comment, which the metrics API serves as the metric's definition, so the definition is written once, in the dbt project.
- **dbt-postgres brings psycopg2-binary.** The adapter still uses psycopg2; the application code uses psycopg 3. Both are binary wheels, so nothing compiles.
- **The metrics API has no port.** It is a standard-library WSGI application; the dashboard's local mode and the tests call it in-process through `httpx.WSGITransport`, with real HTTP semantics and nothing listening. `METRICS_API_URL` points the dashboard at a deployed API instead.
- **The dashboard is a console renderer.** The kata is a Python project with no front end, so the "page" prints ASCII bars; the point of the exercise (fetch, validate, present, compute nothing) does not depend on the rendering technology.
- **The ~150-line limit applies per file.** Each exercise is split into small modules (the extractor into client, storage, quality, configuration and the run itself; the thin client into API and dashboard), and every solution file stays under it.
- **`.env.example` at the kata root** with `replace-with-…` placeholders for the extractor's optional real mode; nothing real is committed.
- **Compose keeps Postgres data in `tmpfs`** and the healthcheck uses `pg_isready -h 127.0.0.1` (TCP), so `docker compose up -d --wait` returns only when the real server accepts connections and `docker compose down` leaves nothing behind.
- **Port 5810** on the host, mapped to the container's 5432; `DATABASE_ADMIN_URL` overrides the admin connection used by the tests, and `DATABASE_URL` the database used by the command-line entry points.

## Not verified

- ⚠️ That Jira Cloud reads absolute JQL dates in the timezone of the user running the search, and only to the minute (the reason for the relative bound): https://support.atlassian.com/jira-software-cloud/docs/jql-fields/
- ⚠️ Current product details of the dbt Semantic Layer and Cube (supported APIs, licensing and hosting options), described in the dbt basics README: https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl and https://cube.dev/docs
