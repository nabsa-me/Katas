import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
import respx
import structlog
from psycopg.conninfo import make_conninfo
from structlog.testing import capture_logs
from tenacity import wait_exponential

from exercises.incremental_jira_extractor.config import load_settings
from exercises.incremental_jira_extractor.extractor import ExitCode, incremental_jql, main, run
from exercises.incremental_jira_extractor.fake_jira import BASE_URL, FakeJira
from exercises.incremental_jira_extractor.jira_client import SEARCH_PATH, JiraClient, JiraIssue
from exercises.incremental_jira_extractor.storage import connect, ensure_tables, upsert_issues
from lib.problem_module import load_problem_module

NOW = datetime(2026, 11, 24, 6, 0, tzinfo=UTC)
TOKEN = "replace-with-an-api-token"


@pytest.fixture
def fake() -> Iterator[FakeJira]:
    fake = FakeJira(now=NOW)
    with respx.mock(base_url=BASE_URL) as router:
        router.post(SEARCH_PATH).mock(side_effect=fake)
        yield fake


def environment(database_url: str, schema: str) -> dict[str, str]:
    return {
        "JIRA_BASE_URL": BASE_URL,
        "JIRA_EMAIL": "etl@example.com",
        "JIRA_API_TOKEN": TOKEN,
        "JIRA_JQL_FILTER": "project in (PAY, WAL, PLT, MOB)",
        "DATABASE_URL": database_url,
        "DATABASE_SCHEMA": schema,
        "PAGE_SIZE": "10",
    }


def extract(database_url: str, schema: str, at: datetime) -> ExitCode:
    """One run of the solution at a fixed time, with retries that do not wait."""
    settings = load_settings(environment(database_url, schema))
    with httpx.Client(base_url=BASE_URL) as http, connect(database_url, schema) as connection:
        client = JiraClient(http, backoff=wait_exponential(multiplier=1, max=30), sleep=lambda _: None)
        return run(connection, client, settings, now=lambda: at)


def query(database_url: str, schema: str, statement: str) -> list[tuple[Any, ...]]:
    with connect(database_url, schema) as connection:
        return connection.execute(statement).fetchall()


def snapshot(database_url: str, schema: str) -> list[tuple[Any, ...]]:
    return query(database_url, schema, "SELECT * FROM jira_issues ORDER BY issue_key")


def watermark(database_url: str, schema: str) -> datetime | None:
    rows = query(database_url, schema, "SELECT last_success_at FROM etl_watermarks")
    return rows[0][0] if rows else None


def test_the_first_run_reads_everything_and_later_runs_read_from_the_watermark() -> None:
    assert incremental_jql("project = PAY", None, NOW, 15) == "(project = PAY) ORDER BY updated ASC, key ASC"
    one_day_ago = NOW - timedelta(days=1)
    assert incremental_jql("project = PAY", one_day_ago, NOW, 15) == (
        '(project = PAY) AND updated >= "-1455m" ORDER BY updated ASC, key ASC'
    )
    # Partial minutes round up, so the window never starts after the watermark.
    assert '"-16m"' in incremental_jql("project = PAY", NOW - timedelta(seconds=30), NOW, 15)


def test_first_run_loads_every_issue_and_saves_the_watermark(database_url: str, schema: str, fake: FakeJira) -> None:
    assert extract(database_url, schema, NOW) == ExitCode.OK

    assert len(snapshot(database_url, schema)) == 31
    assert watermark(database_url, schema) == NOW
    assert "updated >=" not in fake.requests[0]["jql"]


def test_next_run_reads_only_what_changed(database_url: str, schema: str, fake: FakeJira) -> None:
    extract(database_url, schema, NOW)
    tomorrow = NOW + timedelta(days=1)
    fake.now = tomorrow
    fake.update_issue(
        "PAY-107",
        status={"name": "Done", "statusCategory": {"key": "done"}},
        updated="2026-11-24T15:00:00.000+0000",
        resolutiondate="2026-11-24T15:00:00.000+0000",
    )
    fake.requests.clear()

    with capture_logs() as logs:
        assert extract(database_url, schema, tomorrow) == ExitCode.OK

    assert '"-1455m"' in fake.requests[0]["jql"]
    committed = [log for log in logs if log["event"] == "batch_committed"]
    assert [(log["fetched"], log["written"]) for log in committed] == [(1, 1)]
    status = query(database_url, schema, "SELECT status FROM jira_issues WHERE issue_key = 'PAY-107'")
    assert status == [("Done",)]
    assert len(snapshot(database_url, schema)) == 31
    assert watermark(database_url, schema) == tomorrow


def test_replaying_the_same_window_changes_nothing(database_url: str, schema: str, fake: FakeJira) -> None:
    extract(database_url, schema, NOW)
    before = snapshot(database_url, schema)
    # A backfill: forget the watermark and read everything again.
    query(database_url, schema, "DELETE FROM etl_watermarks RETURNING source")

    with capture_logs() as logs:
        assert extract(database_url, schema, NOW + timedelta(hours=1)) == ExitCode.OK

    assert snapshot(database_url, schema) == before  # same rows, same values, same loaded_at
    succeeded = next(log for log in logs if log["event"] == "run_succeeded")
    assert (succeeded["fetched"], succeeded["written"]) == (31, 0)


def test_an_older_version_never_overwrites_a_newer_one(database_url: str, schema: str) -> None:
    def version(summary: str, updated: str) -> JiraIssue:
        return JiraIssue.model_validate(
            {
                "key": "PAY-101",
                "fields": {
                    "summary": summary,
                    "status": {"name": "Done", "statusCategory": {"key": "done"}},
                    "issuetype": {"name": "Story"},
                    "project": {"key": "PAY"},
                    "created": "2026-10-20T09:15:00.000+0000",
                    "updated": updated,
                },
            }
        )

    with connect(database_url, schema) as connection:
        ensure_tables(connection, schema)
        assert upsert_issues(connection, [version("newer", "2026-10-28T16:40:00.000+0000")], NOW) == 1
        assert upsert_issues(connection, [version("older", "2026-10-27T10:00:00.000+0000")], NOW) == 0

    assert query(database_url, schema, "SELECT summary FROM jira_issues") == [("newer",)]


def test_a_failure_midway_keeps_committed_pages_and_the_watermark(
    database_url: str, schema: str, fake: FakeJira
) -> None:
    fake.failing_forever.add(2)

    assert extract(database_url, schema, NOW) == ExitCode.SOURCE_UNAVAILABLE

    # Page 1 was committed in its own transaction; nothing from page 2 on; the watermark did not move.
    assert len(snapshot(database_url, schema)) == 10
    assert watermark(database_url, schema) is None

    fake.failing_forever.clear()
    assert extract(database_url, schema, NOW + timedelta(hours=1)) == ExitCode.OK

    keys = query(database_url, schema, "SELECT count(*), count(DISTINCT issue_key) FROM jira_issues")
    assert keys == [(31, 31)]
    assert watermark(database_url, schema) == NOW + timedelta(hours=1)


def test_a_batch_with_missing_key_fields_is_not_committed(database_url: str, schema: str, fake: FakeJira) -> None:
    fake.update_issue("PLT-305", status=None)  # 14th by `updated`, so on page 2

    with capture_logs() as logs:
        assert extract(database_url, schema, NOW) == ExitCode.DATA_QUALITY_FAILURE

    failed = next(log for log in logs if log["event"] == "quality_check_failed")
    assert failed["issues"] == {"PLT-305": ["status", "status_category"]}
    assert len(snapshot(database_url, schema)) == 10
    assert watermark(database_url, schema) is None


def test_stale_data_fails_the_run_without_moving_the_watermark(database_url: str, schema: str, fake: FakeJira) -> None:
    later = NOW + timedelta(days=10)
    fake.now = later

    with capture_logs() as logs:
        assert extract(database_url, schema, later) == ExitCode.DATA_QUALITY_FAILURE

    failed = next(log for log in logs if log["event"] == "quality_check_failed")
    assert "older than 2 days" in failed["failures"][0]
    assert watermark(database_url, schema) is None


@pytest.fixture
def reset_logging() -> Iterator[None]:
    yield
    structlog.reset_defaults()


@pytest.mark.usefixtures("reset_logging")
def test_main_logs_json_lines_with_one_run_id_and_returns_the_exit_code(
    database_url: str, schema: str, fake: FakeJira, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(environment(database_url, schema), now=lambda: NOW)

    output = capsys.readouterr().out
    lines = [json.loads(line) for line in output.splitlines()]
    assert code == 0
    assert [line["event"] for line in lines][0] == "run_started"
    assert lines[-1]["event"] == "run_finished" and lines[-1]["exit_code"] == 0
    assert len({line["run_id"] for line in lines}) == 1
    assert TOKEN not in output


@pytest.mark.usefixtures("reset_logging")
def test_main_exits_with_one_and_names_the_variables_on_bad_configuration(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main({}) == ExitCode.UNEXPECTED_ERROR

    first = json.loads(capsys.readouterr().out.splitlines()[0])
    assert first["event"] == "config_invalid"
    assert "JIRA_API_TOKEN" in first["error"]


problem = load_problem_module(Path(__file__).with_name("extractor.problem.py"))


def problem_database(database_url: str, schema: str) -> str:
    return make_conninfo(database_url, options=f"-c search_path={schema}")


def test_problem_duplicates_every_issue_on_each_run(database_url: str, schema: str, fake: FakeJira) -> None:
    for _ in range(2):
        problem.extract(BASE_URL, "etl@example.com", TOKEN, problem_database(database_url, schema))

    with psycopg.connect(problem_database(database_url, schema)) as connection:
        counts = connection.execute("SELECT count(*), count(DISTINCT issue_key) FROM jira_issues_copy").fetchone()
    assert counts == (62, 31)
    assert all("updated >=" not in request["jql"] for request in fake.requests)  # downloads everything every time


def test_problem_fails_halfway_reporting_success_and_no_details(
    database_url: str,
    schema: str,
    fake: FakeJira,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    fake.failing_forever.add(2)
    for variable, value in environment(problem_database(database_url, schema), schema).items():
        monkeypatch.setenv(variable, value)

    assert problem.main() == 0

    assert capsys.readouterr().out == "something went wrong\n"
    with psycopg.connect(problem_database(database_url, schema)) as connection:
        rows = connection.execute("SELECT count(*) FROM jira_issues_copy").fetchone()
    assert rows == (10,)  # half a load, and nothing says which half
