"""The team dashboard as a thin client: it asks the governed metrics API for numbers and only presents them.

Run it with `uv run python -m exercises.thin_client_governed_data.dashboard payments` once `dbt build` has run.
"""

import os
import sys
import textwrap
from collections.abc import Mapping, Sequence
from datetime import date

import httpx
from pydantic import BaseModel, Field, ValidationError

from exercises.thin_client_governed_data.metrics_api import MartThroughputSource, make_app
from lib.database import DEFAULT_ADMIN_URL

# The contract with the API is this path and the JSON shape below, not a Python import.
THROUGHPUT_PATH = "/metrics/team-weekly-throughput"
IN_PROCESS_BASE_URL = "http://metrics.local"


class Metric(BaseModel):
    name: str
    description: str
    source: str


class WeekRow(BaseModel):
    team_id: str
    team_name: str
    week_start: date
    resolved_issues: int = Field(ge=0)


class ThroughputReport(BaseModel):
    """Validated like any external data. Unknown fields are ignored, so the API can add some without breaking us."""

    metric: Metric
    data: list[WeekRow]


def fetch_team_throughput(client: httpx.Client, team_id: str) -> ThroughputReport:
    """One request, no credentials for Jira, no business rules: the number arrives already defined."""
    response = client.get(THROUGHPUT_PATH, params={"team": team_id})
    response.raise_for_status()
    return ThroughputReport.model_validate_json(response.content)


def render(team_id: str, report: ThroughputReport) -> str:
    """Formatting only: every number on the screen is one the API returned. ASCII, so any console shows it."""
    team = report.data[0].team_name if report.data else team_id
    lines = [f"{team}: issues resolved per week", ""]
    width = max((row.resolved_issues for row in report.data), default=0)
    for row in report.data:
        lines.append(f"{row.week_start.isoformat()}  {'#' * row.resolved_issues:<{width}}  {row.resolved_issues}")
    if not report.data:
        lines.append("No resolved issues yet.")
    lines += ["", *textwrap.wrap(f"Definition: {report.metric.description}", width=100)]
    lines.append(f"Source: {report.metric.source}")
    return "\n".join(lines)


def metrics_client(environ: Mapping[str, str]) -> httpx.Client:
    """`METRICS_API_URL` points at a deployed API. Without it, the local demo runs the same app in-process."""
    if url := environ.get("METRICS_API_URL"):
        return httpx.Client(base_url=url, timeout=10)
    source = MartThroughputSource(environ.get("DATABASE_URL", DEFAULT_ADMIN_URL))
    return httpx.Client(transport=httpx.WSGITransport(app=make_app(source)), base_url=IN_PROCESS_BASE_URL)


def main(argv: Sequence[str] | None = None, environ: Mapping[str, str] = os.environ) -> int:
    args = sys.argv[1:] if argv is None else argv
    team_id = args[0] if args else "payments"
    try:
        with metrics_client(environ) as client:
            report = fetch_team_throughput(client, team_id)
    except (httpx.HTTPError, ValidationError) as error:
        print(f"Metrics unavailable: {error}", file=sys.stderr)
        return 1
    print(render(team_id, report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
