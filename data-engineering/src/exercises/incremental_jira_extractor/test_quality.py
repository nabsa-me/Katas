from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from exercises.incremental_jira_extractor.jira_client import JiraIssue
from exercises.incremental_jira_extractor.quality import count_mismatch, missing_key_fields, staleness
from exercises.incremental_jira_extractor.storage import connect, ensure_tables, upsert_issues
from lib.sample_issues import sample_issues

NOW = datetime(2026, 11, 24, 6, 0, tzinfo=UTC)


@pytest.fixture
def connection(database_url: str, schema: str) -> Iterator[psycopg.Connection]:
    with connect(database_url, schema) as connection:
        ensure_tables(connection, schema)
        yield connection


def issues() -> list[JiraIssue]:
    return [JiraIssue.model_validate(issue) for issue in sample_issues()]


def test_a_complete_batch_has_no_missing_fields() -> None:
    assert missing_key_fields(issues()) == {}


def test_reports_each_issue_with_the_key_fields_it_lacks() -> None:
    raw = sample_issues()[:3]
    raw[1]["fields"]["status"] = None
    del raw[2]["fields"]["updated"]
    raw[2]["fields"]["assignee"] = None  # optional: not a key field

    missing = missing_key_fields([JiraIssue.model_validate(issue) for issue in raw])

    assert missing == {"PAY-102": ["status", "status_category"], "PAY-103": ["updated"]}


def test_counts_match_when_every_fetched_issue_is_in_the_table(connection: psycopg.Connection) -> None:
    upsert_issues(connection, issues(), loaded_at=NOW)

    assert count_mismatch(connection, ["PAY-101", "PAY-101", "MOB-408"]) is None
    assert count_mismatch(connection, ["PAY-101", "PAY-999"]) == "2 distinct issues fetched but 1 found in jira_issues"


def test_freshness_fails_when_nothing_was_updated_recently(connection: psycopg.Connection) -> None:
    assert staleness(connection, NOW, timedelta(hours=48)) == "jira_issues is empty"

    upsert_issues(connection, issues(), loaded_at=NOW)  # newest update: 2026-11-23 08:30 UTC

    assert staleness(connection, NOW, timedelta(hours=48)) is None
    failure = staleness(connection, NOW + timedelta(days=3), timedelta(hours=48))
    assert failure is not None and "older than 2 days" in failure
