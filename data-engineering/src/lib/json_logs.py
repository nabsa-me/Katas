"""Structured logs: one JSON object per line, so a log platform can filter by `run_id`, `event` or `level`."""

import sys
from typing import TextIO

import structlog


def configure_json_logs(stream: TextIO = sys.stdout) -> None:
    """Called once by each command-line entry point; tests use `structlog.testing.capture_logs()` instead."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.PrintLoggerFactory(file=stream),
        cache_logger_on_first_use=False,
    )
