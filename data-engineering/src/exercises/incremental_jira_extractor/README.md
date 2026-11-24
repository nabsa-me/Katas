# Incremental, idempotent Jira extractor

## Statement

A nightly job copies Jira issues into Postgres so the analytics team can report on them. It was written as a quick script:

```python
connection = psycopg.connect(database_url, autocommit=True)
while True:
    data = httpx.post(jira_url + "/rest/api/3/search/jql", json=body, auth=(email, token)).json()
    for issue in data["issues"]:
        connection.execute("INSERT INTO jira_issues_copy VALUES (%s, %s, %s, %s)", (...))
    ...
# main(): except Exception: print("something went wrong"); return 0
```

Symptoms: every run downloads the whole project again, and the table holds each issue once per run, so every count is inflated. Some mornings the numbers are lower instead: Jira answered a 500 on page 2, the script stopped after page 1 and the scheduler showed a green run. Nobody can tell which runs were partial. Rewrite it so that it reads only what changed, can run twice without changing the result, never leaves a half-applied run behind, checks the data before trusting it and tells the scheduler what happened.

## What gets assessed

- Incremental extraction with a watermark stored in the database, and an overlap window that makes it safe.
- Idempotent loading: `INSERT … ON CONFLICT … DO UPDATE` that only moves forward in time.
- Failure semantics: one transaction per batch, the watermark advanced only after a complete run, retries that honor `Retry-After`.
- Data quality checks (nulls in key fields, counts, freshness) that stop a bad run instead of loading it.
- Operability: structured logs with a run id, and exit codes that mean something to a scheduler and to whoever is on call.

## How to approach it, step by step

1. Reproduce both symptoms with a fake Jira (respx): run the script twice and count rows; make page 2 fail and look at what is left and at the exit code.
2. Give the table a primary key (`issue_key`) and turn the insert into an upsert. Decide what happens when the row exists: replace it only if the incoming version is newer.
3. Add a control table `etl_watermarks` and build the JQL from it: everything on the first run, then `updated >= <last success - overlap>`. Decide what "last success" is and when it is written.
4. Split the run into batches (one per page) and wrap each one in a transaction. Write the watermark only after every page and every check has passed.
5. Wrap the HTTP call in a retry policy: which statuses are retried, how long to wait, when to give up.
6. Add the quality gates: a batch with nulls in key fields is not committed; after the load, the counts must match and the newest update must be recent.
7. Replace `print` with JSON logs carrying a run id, and map each outcome to an exit code.
8. Prove each property with a test: rerun, backfill, failure midway, bad batch, stale data.

## Solution explained

[`extractor.py`](./extractor.py) runs the extraction, [`jira_client.py`](./jira_client.py) reads Jira, [`storage.py`](./storage.py) owns the tables, [`quality.py`](./quality.py) the checks and [`config.py`](./config.py) the settings. [`extractor.problem.py`](./extractor.problem.py) is the flawed script. [`fake_jira.py`](./fake_jira.py) is the respx fake both versions run against: it pages the 31 fictional issues 10 at a time, sorted by `updated`, honors the relative `updated` bound and fails on demand. The tests are [`test_extractor.py`](./test_extractor.py) (runs end to end against Postgres, and the problem's behaviour), [`test_jira_client.py`](./test_jira_client.py), [`test_quality.py`](./test_quality.py) and [`test_config.py`](./test_config.py).

**The watermark.** `etl_watermarks(source, last_success_at, updated_at)` keeps one row per source. `last_success_at` is the time the last **successful** run **started**, not the newest `updated` it saw: anything changed while a run was in progress is newer than that start, so the next run picks it up. The first run has no watermark and reads the whole filter (`project in (…)`; the search endpoint needs a bounded query anyway).

**A relative bound with an overlap.** Later runs search `(<filter>) AND updated >= "-1455m" ORDER BY updated ASC, key ASC`, where 1455 is the minutes since the watermark (rounded up) plus a 15-minute overlap:

```python
minutes = math.ceil((now - watermark).total_seconds() / 60) + overlap_minutes
return f'({base_filter}) AND updated >= "-{minutes}m" {order}'
```

A relative bound is evaluated by Jira against its own clock, so it does not depend on the timezone in which Jira reads an absolute date such as `"2026/11/24 06:00"`. ⚠️ Verify: Jira Cloud interprets absolute JQL dates in the timezone of the user running the search and only to the minute ([JQL fields: Updated](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/)). The overlap absorbs what remains: minute rounding, clock skew between this machine and Jira, issues that reach the search index a little late, and the time the run itself takes (every page request sends the JQL again). Overlap means some issues are read twice; the upsert makes that harmless.

**An upsert that never goes back in time.**

```sql
INSERT INTO jira_issues (...) VALUES (...)
ON CONFLICT (issue_key) DO UPDATE SET ... , loaded_at = EXCLUDED.loaded_at
WHERE jira_issues.updated_at < EXCLUDED.updated_at
```

The primary key makes a second copy impossible. The `WHERE` on the update means a row is only replaced by a newer version of the issue: replaying a page, reading the overlap again or receiving an old version after a new one changes nothing, not even `loaded_at`. `cursor.rowcount` counts only the rows actually inserted or replaced, which the logs report as `written`. psycopg 3 runs `executemany` in pipeline mode when the bundled libpq supports it (it does), so a page of 100 rows does not cost 100 round trips.

**One transaction per batch, the watermark last.** The connection is in autocommit mode, so the only transactions are the explicit ones: each page is upserted inside `with connection.transaction():`. If page 3 fails, pages 1 and 2 stay committed and consistent, page 3 is rolled back entirely, and the watermark has not moved, because it is written only after the last page and the post-load checks. The next run starts from the same watermark, reads the same window again and the upsert absorbs what was already there. That is the whole recovery procedure: rerun. A backfill is the same move on purpose: delete the source's row in `etl_watermarks` and run.

**Retries.** [`JiraClient`](./jira_client.py) uses tenacity's `Retrying` around a single request. It retries 429 and 5xx answers and network errors (`httpx.TransportError`, timeouts included), up to 5 attempts. The wait is exponential backoff with jitter (`wait_exponential_jitter`: 1 s, 2 s, 4 s… plus up to 1 s at random, capped at 30 s), and when Jira sends `Retry-After` (seconds, on 429 and some 503s) that value is the minimum. A 400 (invalid JQL), 401 or 403 is not retried: it would fail the same way five times. The search is a `POST`, but it is a read, so repeating it is safe. After the last attempt the client raises `SourceUnavailableError`. `sleep` and the backoff are injected, so the tests assert the exact delays (`[7.0]` for `Retry-After: 7`, `[1.0, 2.0, 4.0, 8.0]` before giving up) without waiting.

**Two layers of validation.** Pydantic checks the **shape** at the boundary: [`JiraIssue`](./jira_client.py) flattens the nested fields with `AliasPath` (`fields.status.statusCategory.key` becomes `status_category`) and parses Jira's dates with their offsets (`+0100`) into timezone-aware datetimes. Every field except `key` may be missing, because completeness is a **data quality** decision, made in [`quality.py`](./quality.py):

- **Before a batch is committed**: no nulls in the key fields (`project_key`, `summary`, `status`, `status_category`, `issue_type`, `created`, `updated`). A batch with one incomplete issue is not committed, the run stops with the issue keys and the missing fields in the log, and the watermark stays. The table's `NOT NULL` constraints are the last line of defence behind this check.
- **After the load**: every distinct issue fetched is in the table (counts), and the newest `updated_at` is not older than 48 hours (freshness). Nothing updated for two days usually means a filter that no longer matches (a renamed label, status or component), not a quiet team, and such a filter returns empty pages with a 200.

**Exit codes for a scheduler.**

| Code | Meaning                                      | First action                                       |
| ---- | -------------------------------------------- | -------------------------------------------------- |
| 0    | Run complete, checks passed, watermark moved | None                                               |
| 1    | Unexpected error, bad configuration or 4xx   | Read the `run_failed` / `config_invalid` log line  |
| 2    | Data quality failure                         | Look at the source data named in the log           |
| 3    | Jira still unavailable after every retry     | Usually nothing: the next run catches up by itself |

Distinct codes let the scheduler (cron, a Kubernetes `CronJob`, an ECS scheduled task, Airflow) retry code 3 automatically and page someone for 1 and 2. The problem returns 0 for everything, so a partial load looks like a success.

**Structured logs.** [`lib/json_logs.py`](../../lib/json_logs.py) configures structlog to print one JSON object per line. `main()` binds a `run_id` and the source with `bound_contextvars`, so every line of a run, including the client's `jira_retry` warnings, carries them: `run_started` (watermark and JQL), one `batch_committed` per page (`fetched`, `written`), then `run_succeeded`, `quality_check_failed` or `source_unavailable`, and finally `run_finished` with the exit code and the duration. The API token is a `SecretStr`, which prints as `**********`, and a test checks that the real value never reaches the output.

**Configuration.** [`config.py`](./config.py) validates the environment once at startup and lists every invalid or missing variable in one message. The schema name ends up in the connection's `search_path`, so it must match `^[a-z_][a-z0-9_]*$`. In AWS, the token would come from Secrets Manager or SSM Parameter Store into the task's environment, never from the repository.

**How it is proven.** `test_extractor.py` runs the real extractor against Postgres and the fake Jira: the first run loads 31 issues and saves the watermark; the next day only the changed issue is fetched (`"-1455m"`) and written; a backfill over the same data leaves the table identical (same rows, values and `loaded_at`) with `written` 0; an older version does not overwrite a newer one; with page 2 failing forever the run exits 3 with exactly page 1 committed and no watermark, and the rerun completes with 31 distinct rows; an incomplete issue on page 2 stops the run with code 2 and page 2 uncommitted; stale data exits 2; `main()` prints JSON lines sharing one `run_id` and never the token. The same file proves the problem: two runs leave 62 rows for 31 issues, and a failure on page 2 leaves 10 rows, prints "something went wrong" and returns 0.

## Common mistakes

| Symptom                                              | Cause                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Every count doubles after a rerun                    | Plain `INSERT` with no unique key: nothing identifies a row as "the same issue".                              |
| Issues changed late in the evening are never loaded  | Watermark equal to the run's end, or to the newest `updated` seen, with no overlap.                           |
| A rerun after a failure skips data                   | The watermark was written before the run finished, or per page.                                               |
| A replayed old page overwrites newer values          | `ON CONFLICT DO UPDATE` without `WHERE jira_issues.updated_at < EXCLUDED.updated_at`.                         |
| Half a run in the table after a crash, and no record | Autocommit per row, and the exception swallowed: nothing says where the run stopped.                          |
| A failure on the last page throws away the whole run | One transaction for the whole run: hours of good pages rolled back, and locks held all that time.             |
| The job hammers Jira during an incident              | Retries without backoff or without a cap, or ignoring `Retry-After`.                                          |
| A wrong JQL retries five times                       | Retrying every error, including 400, 401 and 403.                                                             |
| Green runs, empty dashboards                         | No freshness check: a filter that no longer matches anything returns empty pages with a 200.                  |
| Hours lost reading logs to find one run              | Free-text `print` lines with no run id, no level and no counts.                                               |
| An absolute date bound misses or repeats a few hours | The absolute date is read in a timezone the job did not choose (see the ⚠️ note above); use a relative bound. |

## Practice

Add a `--since <ISO date>` option that runs a bounded backfill without touching the stored watermark, and a test proving that a backfill over a window already loaded writes nothing.
