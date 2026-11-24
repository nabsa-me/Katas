"""Incremental, idempotent extraction of Jira issues into Postgres, built to run unattended once a day.

Run it with `uv run --env-file .env python -m exercises.incremental_jira_extractor.extractor`.
"""

import math
import os
import sys
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from enum import IntEnum
from uuid import uuid4

import httpx
import psycopg
import structlog

from exercises.incremental_jira_extractor.config import ConfigError, ExtractorSettings, load_settings
from exercises.incremental_jira_extractor.jira_client import JiraClient, SourceUnavailableError
from exercises.incremental_jira_extractor.quality import missing_key_fields, post_load_failures
from exercises.incremental_jira_extractor.storage import (
    SOURCE,
    connect,
    ensure_tables,
    read_watermark,
    save_watermark,
    upsert_issues,
)
from lib.json_logs import configure_json_logs


class ExitCode(IntEnum):
    """What the scheduler sees. Each code points to a different first action for whoever is on call."""

    OK = 0
    UNEXPECTED_ERROR = 1  # a bug, bad configuration or credentials: read the logs
    DATA_QUALITY_FAILURE = 2  # the data arrived but is not trustworthy: check the source
    SOURCE_UNAVAILABLE = 3  # Jira kept failing after every retry: usually safe to rerun later


def incremental_jql(base_filter: str, watermark: datetime | None, now: datetime, overlap_minutes: int) -> str:
    """The first run reads everything; later runs read from the last success minus an overlap.

    The bound is relative (`-1455m`) because Jira reads absolute dates in the account's timezone and only to the
    minute. The overlap covers that rounding, clock skew, issues indexed late and the time the run itself takes.
    """
    order = "ORDER BY updated ASC, key ASC"
    if watermark is None:
        return f"({base_filter}) {order}"
    minutes = math.ceil((now - watermark).total_seconds() / 60) + overlap_minutes
    return f'({base_filter}) AND updated >= "-{minutes}m" {order}'


def run(
    connection: psycopg.Connection,
    client: JiraClient,
    settings: ExtractorSettings,
    now: Callable[[], datetime],
) -> ExitCode:
    log = structlog.get_logger()
    started_at = now()
    ensure_tables(connection, settings.database_schema)
    watermark = read_watermark(connection)
    jql = incremental_jql(settings.jql_filter, watermark, started_at, settings.overlap_minutes)
    log.info("run_started", watermark=watermark.isoformat() if watermark else None, jql=jql)

    fetched_keys: set[str] = set()
    written = 0
    try:
        for page, issues in enumerate(client.search_pages(jql, settings.page_size), start=1):
            incomplete = missing_key_fields(issues)
            if incomplete:
                log.error("quality_check_failed", check="key_fields_not_null", page=page, issues=incomplete)
                return ExitCode.DATA_QUALITY_FAILURE
            # One transaction per page: a failure later in the run keeps every page committed before it.
            with connection.transaction():
                page_written = upsert_issues(connection, issues, loaded_at=started_at)
            fetched_keys.update(issue.key for issue in issues)
            written += page_written
            log.info("batch_committed", page=page, fetched=len(issues), written=page_written)
    except SourceUnavailableError as error:
        log.error("source_unavailable", error=str(error), fetched=len(fetched_keys), written=written)
        return ExitCode.SOURCE_UNAVAILABLE

    failures = post_load_failures(connection, fetched_keys, now(), timedelta(hours=settings.freshness_max_age_hours))
    if failures:
        log.error("quality_check_failed", check="post_load", failures=failures)
        return ExitCode.DATA_QUALITY_FAILURE

    # Only a complete, checked run moves the watermark; any earlier exit leaves it where it was.
    save_watermark(connection, started_at)
    log.info("run_succeeded", fetched=len(fetched_keys), written=written, watermark=started_at.isoformat())
    return ExitCode.OK


def main(environ: Mapping[str, str] = os.environ, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> int:
    configure_json_logs()
    log = structlog.get_logger()
    with structlog.contextvars.bound_contextvars(run_id=str(uuid4()), source=SOURCE):
        started = time.monotonic()
        try:
            settings = load_settings(environ)
            auth = httpx.BasicAuth(settings.jira_email, settings.jira_api_token.get_secret_value())
            base_url = str(settings.jira_base_url).rstrip("/")
            with (
                httpx.Client(base_url=base_url, auth=auth, timeout=httpx.Timeout(30, connect=10)) as http,
                connect(settings.database_url, settings.database_schema) as connection,
            ):
                code = run(connection, JiraClient(http), settings, now)
        except ConfigError as error:
            log.error("config_invalid", error=str(error))
            code = ExitCode.UNEXPECTED_ERROR
        except Exception:
            log.exception("run_failed")
            code = ExitCode.UNEXPECTED_ERROR
        log.info("run_finished", exit_code=int(code), duration_ms=round((time.monotonic() - started) * 1000))
        return int(code)


if __name__ == "__main__":
    sys.exit(main())
