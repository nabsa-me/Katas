"""Lands the fictional Jira issues in `raw.jira_issues` with the extractor's own tables and upsert, as a run would.

Run it with `uv run python -m exercises.dbt_basics.load_raw_issues` (`DATABASE_URL` overrides the local Postgres).
"""

import os
import sys
from datetime import UTC, datetime

from exercises.incremental_jira_extractor.jira_client import JiraIssue
from exercises.incremental_jira_extractor.storage import connect, ensure_tables, upsert_issues
from lib.database import DEFAULT_ADMIN_URL
from lib.sample_issues import sample_issues

RAW_SCHEMA = "raw"


def load_raw_issues(database_url: str, loaded_at: datetime | None = None) -> int:
    """Returns how many rows were written (0 when the same sample was already loaded)."""
    issues = [JiraIssue.model_validate(issue) for issue in sample_issues()]
    with connect(database_url, RAW_SCHEMA) as connection:
        ensure_tables(connection, RAW_SCHEMA)
        with connection.transaction():
            return upsert_issues(connection, issues, loaded_at or datetime.now(UTC))


def main() -> int:
    written = load_raw_issues(os.environ.get("DATABASE_URL", DEFAULT_ADMIN_URL))
    print(f"{written} issues written to {RAW_SCHEMA}.jira_issues")
    return 0


if __name__ == "__main__":
    sys.exit(main())
