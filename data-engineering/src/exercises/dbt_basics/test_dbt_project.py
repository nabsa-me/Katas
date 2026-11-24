import re
import subprocess
from collections.abc import Iterator
from datetime import date
from typing import Any

import psycopg
import pytest

from exercises.dbt_basics.dbt_runner import run_dbt
from exercises.dbt_basics.load_raw_issues import load_raw_issues
from lib.database import temporary_database

MART = "analytics_marts.fct_team_weekly_throughput"

# Worked out by hand from src/data/jira_issues.json: done issues, by team, in the ISO week of their resolution date.
EXPECTED_THROUGHPUT = [
    ("mobile", date(2026, 10, 26), 1),
    ("mobile", date(2026, 11, 2), 1),
    ("mobile", date(2026, 11, 9), 1),
    ("mobile", date(2026, 11, 16), 2),
    ("payments", date(2026, 10, 26), 3),
    ("payments", date(2026, 11, 2), 2),
    ("payments", date(2026, 11, 9), 3),
    ("payments", date(2026, 11, 16), 4),
    ("platform", date(2026, 10, 26), 1),
    ("platform", date(2026, 11, 2), 3),
    ("platform", date(2026, 11, 9), 1),
    ("platform", date(2026, 11, 16), 1),
]


def query(database_url: str, statement: str) -> list[tuple[Any, ...]]:
    with psycopg.connect(database_url) as connection:
        return connection.execute(statement).fetchall()


def summary(output: str) -> dict[str, int]:
    found = re.search(r"PASS=(\d+) WARN=(\d+) ERROR=(\d+) SKIP=(\d+)", output)
    assert found, output
    return dict(zip(("PASS", "WARN", "ERROR", "SKIP"), map(int, found.groups()), strict=True))


def test_build_runs_seeds_models_and_every_data_test(dbt_build: subprocess.CompletedProcess[str]) -> None:
    # 2 seeds + 3 models + 21 data tests, in dependency order, each test right after the node it checks.
    assert summary(dbt_build.stdout) == {"PASS": 26, "WARN": 0, "ERROR": 0, "SKIP": 0}
    assert "deprecat" not in dbt_build.stdout.lower()  # the YAML uses dbt 1.12's `config:` and `arguments:`


def test_the_mart_counts_resolved_issues_per_team_and_week(database_url: str, dbt_build: object) -> None:
    rows = query(database_url, f"SELECT team_id, week_start, resolved_issues FROM {MART} ORDER BY 1, 2")

    assert rows == EXPECTED_THROUGHPUT


def test_the_contract_fixes_the_mart_columns_and_types(database_url: str, dbt_build: object) -> None:
    columns = query(
        database_url,
        """
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'analytics_marts' AND table_name = 'fct_team_weekly_throughput'
        ORDER BY ordinal_position
        """,
    )

    assert columns == [
        ("team_id", "text", "NO"),
        ("team_name", "text", "NO"),
        ("week_start", "date", "NO"),
        ("resolved_issues", "integer", "NO"),
    ]
    checks = query(
        database_url, f"SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = '{MART}'::regclass"
    )
    assert checks == [("CHECK ((resolved_issues > 0))",)]


def test_the_definition_is_stored_with_the_mart(database_url: str, dbt_build: object) -> None:
    [(comment,)] = query(database_url, f"SELECT obj_description('{MART}'::regclass)")

    assert comment.startswith("Issue throughput per team per week: issues whose status category is done")


def test_loading_the_same_sample_again_writes_nothing(database_url: str, dbt_build: object) -> None:
    assert load_raw_issues(database_url) == 0


def test_source_freshness_passes_right_after_a_load(database_url: str, dbt_build: object) -> None:
    result = run_dbt(["source", "freshness"], database_url)

    assert result.returncode == 0, result.stdout
    assert re.search(r"PASS freshness of jira\.jira_issues", result.stdout)


@pytest.fixture(scope="module")
def scratch_warehouse(database_url: str) -> Iterator[str]:
    """A second database for the failures, so the session's warehouse stays correct for the other tests."""
    with temporary_database("dbt_failures") as url:
        load_raw_issues(url)
        yield url


def test_a_failing_data_test_stops_the_build_before_the_mart(scratch_warehouse: str) -> None:
    with psycopg.connect(scratch_warehouse) as connection:
        connection.execute(
            """
            INSERT INTO raw.jira_issues (issue_key, project_key, summary, status, status_category, issue_type,
                                         created_at, updated_at, resolved_at, loaded_at)
            VALUES ('OPS-1', 'OPS', 'A project no team owns', 'Done', 'done', 'Task', now(), now(), now(), now())
            """
        )

    result = run_dbt(["build"], scratch_warehouse)

    assert result.returncode == 1
    assert re.search(r"FAIL 1 relationships_stg_jira__issues_project_key", result.stdout)
    assert summary(result.stdout)["SKIP"] > 0  # everything downstream of the failed test
    assert query(scratch_warehouse, f"SELECT to_regclass('{MART}')") == [(None,)]  # never built with bad data


def test_a_stale_source_fails_freshness(scratch_warehouse: str) -> None:
    with psycopg.connect(scratch_warehouse) as connection:
        connection.execute("UPDATE raw.jira_issues SET loaded_at = now() - interval '3 days'")

    result = run_dbt(["source", "freshness"], scratch_warehouse)

    assert result.returncode == 1
    assert re.search(r"ERROR STALE freshness of jira\.jira_issues", result.stdout)
