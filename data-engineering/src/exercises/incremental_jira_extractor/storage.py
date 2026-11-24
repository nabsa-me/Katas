"""The raw landing table, upserts that never go back in time, and the watermark that makes runs incremental."""

from collections.abc import Sequence
from datetime import datetime

import psycopg
from psycopg import sql

from exercises.incremental_jira_extractor.jira_client import JiraIssue

SOURCE = "jira_issues"

# In production a migration tool owns this DDL; here it keeps the exercise self-contained.
TABLES = """
CREATE TABLE IF NOT EXISTS jira_issues (
  issue_key           text PRIMARY KEY,
  project_key         text NOT NULL,
  summary             text NOT NULL,
  status              text NOT NULL,
  status_category     text NOT NULL,
  issue_type          text NOT NULL,
  assignee_account_id text,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  resolved_at         timestamptz,
  loaded_at           timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS etl_watermarks (
  source          text PRIMARY KEY,
  last_success_at timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
"""

# A row is only replaced by a newer version of the issue, so replaying a page, or receiving pages out of
# order, never overwrites newer data. Rows that are not newer are left untouched (and not counted).
UPSERT = """
INSERT INTO jira_issues (issue_key, project_key, summary, status, status_category, issue_type,
                         assignee_account_id, created_at, updated_at, resolved_at, loaded_at)
VALUES (%(key)s, %(project_key)s, %(summary)s, %(status)s, %(status_category)s, %(issue_type)s,
        %(assignee_account_id)s, %(created)s, %(updated)s, %(resolved)s, %(loaded_at)s)
ON CONFLICT (issue_key) DO UPDATE SET
  project_key = EXCLUDED.project_key,
  summary = EXCLUDED.summary,
  status = EXCLUDED.status,
  status_category = EXCLUDED.status_category,
  issue_type = EXCLUDED.issue_type,
  assignee_account_id = EXCLUDED.assignee_account_id,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  resolved_at = EXCLUDED.resolved_at,
  loaded_at = EXCLUDED.loaded_at
WHERE jira_issues.updated_at < EXCLUDED.updated_at
"""


def connect(database_url: str, schema: str) -> psycopg.Connection:
    """Autocommit: the only transactions are the explicit `with connection.transaction()` blocks."""
    return psycopg.connect(database_url, autocommit=True, options=f"-c search_path={schema}")


def ensure_tables(connection: psycopg.Connection, schema: str) -> None:
    connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
    connection.execute(TABLES)


def upsert_issues(connection: psycopg.Connection, issues: Sequence[JiraIssue], loaded_at: datetime) -> int:
    """Returns how many rows were inserted or replaced by a newer version."""
    with connection.cursor() as cursor:
        cursor.executemany(UPSERT, [{**issue.model_dump(), "loaded_at": loaded_at} for issue in issues])
        return cursor.rowcount


def read_watermark(connection: psycopg.Connection) -> datetime | None:
    row = connection.execute("SELECT last_success_at FROM etl_watermarks WHERE source = %s", [SOURCE]).fetchone()
    return row[0] if row else None


def save_watermark(connection: psycopg.Connection, at: datetime) -> None:
    connection.execute(
        """
        INSERT INTO etl_watermarks (source, last_success_at) VALUES (%s, %s)
        ON CONFLICT (source) DO UPDATE SET last_success_at = EXCLUDED.last_success_at, updated_at = now()
        """,
        [SOURCE, at],
    )
