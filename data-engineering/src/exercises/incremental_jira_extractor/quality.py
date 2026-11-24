"""Data quality gates: before a batch is committed, and after the run, before the watermark moves."""

from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta

import psycopg

from exercises.incremental_jira_extractor.jira_client import JiraIssue

# Without them a row is useless downstream (no team, no status, no week): the batch is rejected.
KEY_FIELDS = ("project_key", "summary", "status", "status_category", "issue_type", "created", "updated")


def missing_key_fields(issues: Sequence[JiraIssue]) -> dict[str, list[str]]:
    """Issue key → names of the key fields that are null. Empty when the batch is complete."""
    missing = {issue.key: [name for name in KEY_FIELDS if getattr(issue, name) is None] for issue in issues}
    return {key: names for key, names in missing.items() if names}


def count_mismatch(connection: psycopg.Connection, fetched_keys: Iterable[str]) -> str | None:
    """Every distinct issue fetched in this run must be in the table, whether it was written or already current."""
    keys = sorted(set(fetched_keys))
    row = connection.execute("SELECT count(*) FROM jira_issues WHERE issue_key = ANY(%s)", [keys]).fetchone()
    found = row[0] if row else 0
    return None if found == len(keys) else f"{len(keys)} distinct issues fetched but {found} found in jira_issues"


def staleness(connection: psycopg.Connection, now: datetime, max_age: timedelta) -> str | None:
    """Nothing updated for longer than `max_age` usually means a filter that no longer matches, not a quiet team."""
    row = connection.execute("SELECT max(updated_at) FROM jira_issues").fetchone()
    newest = row[0] if row else None
    if newest is None:
        return "jira_issues is empty"
    if now - newest > max_age:
        return f"newest update is {newest.isoformat()}, older than {max_age}"
    return None


def post_load_failures(
    connection: psycopg.Connection, fetched_keys: Iterable[str], now: datetime, max_age: timedelta
) -> list[str]:
    checks = [count_mismatch(connection, fetched_keys), staleness(connection, now, max_age)]
    return [failure for failure in checks if failure is not None]
