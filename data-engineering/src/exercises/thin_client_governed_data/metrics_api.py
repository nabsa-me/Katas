"""A governed metrics API: it serves the dbt mart as it is, with the metric's definition, and computes nothing.

Plain WSGI from the standard library. Nothing listens on a port here: the dashboard and the tests call the app
in-process through `httpx.WSGITransport`. Deployed, the same app runs behind any WSGI server.
"""

import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import date
from http import HTTPStatus
from typing import Any, Protocol
from urllib.parse import parse_qs
from wsgiref.types import StartResponse, WSGIApplication, WSGIEnvironment

import psycopg

MART = "analytics_marts.fct_team_weekly_throughput"
METRIC_NAME = "team_weekly_throughput"
CATALOG_PATH = "/metrics"
THROUGHPUT_PATH = "/metrics/team-weekly-throughput"
TEAM_ID = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


@dataclass(frozen=True)
class WeeklyThroughput:
    team_id: str
    team_name: str
    week_start: date
    resolved_issues: int


class ThroughputSource(Protocol):
    """Where the governed numbers live. The API passes them on; it never derives them."""

    def describe(self) -> str: ...

    def weekly_throughput(self, team_id: str | None) -> list[WeeklyThroughput]: ...


class MartThroughputSource:
    """Reads the mart that dbt built and tested. The definition stays in dbt; this class only selects."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def connect(self) -> psycopg.Connection:
        # A guard against accidental writes; the real boundary is a role with SELECT on the marts schema only.
        return psycopg.connect(self._database_url, options="-c default_transaction_read_only=on")

    def describe(self) -> str:
        """The model's description, stored by dbt's `persist_docs` as the table comment: one source of truth."""
        with self.connect() as connection:
            row = connection.execute("SELECT obj_description(%s::regclass)", [MART]).fetchone()
        return (row[0] or "").strip() if row else ""

    def weekly_throughput(self, team_id: str | None) -> list[WeeklyThroughput]:
        with self.connect() as connection:
            rows = connection.execute(
                f"""
                SELECT team_id, team_name, week_start, resolved_issues FROM {MART}
                WHERE %(team)s::text IS NULL OR team_id = %(team)s
                ORDER BY team_id, week_start
                """,
                {"team": team_id},
            ).fetchall()
        return [WeeklyThroughput(*row) for row in rows]


def catalog(source: ThroughputSource) -> dict[str, Any]:
    """What a consumer can ask for, with each definition, so nobody has to guess what a number means."""
    return {
        "metrics": [
            {
                "name": METRIC_NAME,
                "description": source.describe(),
                "path": THROUGHPUT_PATH,
                "parameters": {"team": "Optional team id, for example `payments`. Without it, every team."},
            }
        ]
    }


def throughput(source: ThroughputSource, team_id: str | None) -> dict[str, Any]:
    return {
        "metric": {"name": METRIC_NAME, "description": source.describe(), "source": MART},
        "data": [asdict(row) | {"week_start": row.week_start.isoformat()} for row in source.weekly_throughput(team_id)],
    }


def make_app(source: ThroughputSource) -> WSGIApplication:
    """Read-only routes: `GET /metrics` (catalog) and `GET /metrics/team-weekly-throughput[?team=<id>]`."""

    def app(environ: WSGIEnvironment, start_response: StartResponse) -> Iterable[bytes]:
        path = environ.get("PATH_INFO", "")
        if path not in (CATALOG_PATH, THROUGHPUT_PATH):
            return _json(start_response, HTTPStatus.NOT_FOUND, {"error": f"No metric at {path}"})
        if environ["REQUEST_METHOD"] != "GET":
            return _json(start_response, HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Read-only API"}, [("Allow", "GET")])
        teams = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True).get("team")
        team_id = teams[-1] if teams else None
        if team_id is not None and not TEAM_ID.match(team_id):
            return _json(start_response, HTTPStatus.BAD_REQUEST, {"error": "team must be a team id like `payments`"})
        try:
            body = catalog(source) if path == CATALOG_PATH else throughput(source, team_id)
        except psycopg.Error:
            # Down, or the mart not built yet: say so, never fall back to computing the number another way.
            return _json(start_response, HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Metrics store unavailable"})
        return _json(start_response, HTTPStatus.OK, body)

    return app


def _json(
    start_response: StartResponse, status: HTTPStatus, body: object, headers: Sequence[tuple[str, str]] = ()
) -> list[bytes]:
    payload = json.dumps(body).encode()
    content = [("Content-Type", "application/json"), ("Content-Length", str(len(payload)))]
    start_response(f"{status.value} {status.phrase}", [*content, *headers])
    return [payload]
