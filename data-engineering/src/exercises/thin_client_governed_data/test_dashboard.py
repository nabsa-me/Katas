import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from pydantic import ValidationError

from exercises.incremental_jira_extractor.jira_client import SEARCH_PATH
from exercises.thin_client_governed_data.dashboard import THROUGHPUT_PATH, fetch_team_throughput, main, render
from exercises.thin_client_governed_data.metrics_api import MartThroughputSource
from lib.problem_module import load_problem_module
from lib.sample_issues import sample_issues

METRICS_URL = "https://metrics.example.com"
JIRA_URL = "https://example.atlassian.net"
TOKEN = "replace-with-an-api-token"

ROW: dict[str, Any] = {"team_id": "payments", "team_name": "Payments", "week_start": "2026-11-09", "resolved_issues": 3}
PAYLOAD: dict[str, Any] = {
    "metric": {
        "name": "team_weekly_throughput",
        "description": "Done issues per team, in the week they were resolved.",
        "source": "analytics_marts.fct_team_weekly_throughput",
    },
    "data": [ROW, ROW | {"week_start": "2026-11-16", "resolved_issues": 4}],
}


@pytest.fixture
def metrics_api() -> Iterator[respx.MockRouter]:
    # Any request that is not mocked here fails the test: the dashboard may talk to the metrics API only.
    with respx.mock(base_url=METRICS_URL, assert_all_mocked=True) as router:
        yield router


def test_the_dashboard_shows_what_the_api_returns_and_nothing_else(metrics_api: respx.MockRouter) -> None:
    route = metrics_api.get(THROUGHPUT_PATH, params={"team": "payments"}).respond(json=PAYLOAD)

    with httpx.Client(base_url=METRICS_URL) as client:
        report = fetch_team_throughput(client, "payments")

    assert route.call_count == 1
    assert render("payments", report).splitlines() == [
        "Payments: issues resolved per week",
        "",
        "2026-11-09  ###   3",
        "2026-11-16  ####  4",
        "",
        "Definition: Done issues per team, in the week they were resolved.",
        "Source: analytics_marts.fct_team_weekly_throughput",
    ]


@pytest.mark.parametrize(
    "broken",
    [
        {"data": [ROW | {"resolved_issues": "many"}]},
        {"data": [ROW | {"resolved_issues": -1}]},
        {"data": [ROW | {"week_start": "last week"}]},
        {"metric": None},
    ],
)
def test_a_payload_that_breaks_the_contract_is_rejected_not_rendered(
    metrics_api: respx.MockRouter, broken: dict[str, Any]
) -> None:
    metrics_api.get(THROUGHPUT_PATH).respond(json=PAYLOAD | broken)

    with httpx.Client(base_url=METRICS_URL) as client, pytest.raises(ValidationError):
        fetch_team_throughput(client, "payments")


def test_main_shows_the_governed_numbers_without_any_jira_credentials(
    database_url: str, dbt_build: object, capsys: pytest.CaptureFixture[str]
) -> None:
    # Only the warehouse: no JIRA_* variable exists, so the dashboard has nothing to call Jira with.
    assert main(["payments"], {"DATABASE_URL": database_url}) == 0

    lines = capsys.readouterr().out.splitlines()
    assert lines[:6] == [
        "Payments: issues resolved per week",
        "",
        "2026-10-26  ###   3",
        "2026-11-02  ##    2",
        "2026-11-09  ###   3",
        "2026-11-16  ####  4",
    ]
    assert lines[7].startswith("Definition: Issue throughput per team per week")


def test_main_exits_with_one_when_the_api_is_unavailable(
    metrics_api: respx.MockRouter, capsys: pytest.CaptureFixture[str]
) -> None:
    metrics_api.get(THROUGHPUT_PATH).respond(503, json={"error": "Metrics store unavailable"})

    assert main(["payments"], {"METRICS_API_URL": METRICS_URL}) == 1
    assert "Metrics unavailable" in capsys.readouterr().err


problem = load_problem_module(Path(__file__).with_name("dashboard.problem.py"))


def jira_search(request: httpx.Request) -> httpx.Response:
    """A Jira search that honors `project in (…)`; one page is enough for one team's issues."""
    found = re.search(r"project in \(([^)]*)\)", json.loads(request.content)["jql"])
    assert found
    projects = found.group(1).split(", ")
    issues = [issue for issue in sample_issues() if issue["fields"]["project"]["key"] in projects]
    return httpx.Response(200, json={"issues": issues, "isLast": True})


@pytest.fixture
def jira() -> Iterator[respx.Route]:
    with respx.mock(base_url=JIRA_URL) as router:
        yield router.post(SEARCH_PATH).mock(side_effect=jira_search)


def test_the_problem_page_disagrees_with_the_governed_metric_on_the_same_data(
    database_url: str, dbt_build: object, jira: respx.Route
) -> None:
    page = problem.weekly_throughput(JIRA_URL, "dashboard@example.com", TOKEN, "payments")
    mart = MartThroughputSource(database_url).weekly_throughput("payments")
    governed = {row.week_start.isoformat(): row.resolved_issues for row in mart}

    assert governed == {"2026-10-26": 3, "2026-11-02": 2, "2026-11-09": 3, "2026-11-16": 4}
    # `Closed` issues (PAY-104, WAL-203, WAL-204) are missing, and PAY-106 moved to the week it was last touched.
    assert page == {"2026-10-26": 3, "2026-11-02": 1, "2026-11-09": 1, "2026-11-16": 3, "2026-11-23": 1}
    assert (sum(governed.values()), sum(page.values())) == (12, 9)


def test_the_problem_page_downloads_the_team_history_from_jira_on_every_view(jira: respx.Route) -> None:
    for _ in range(3):
        problem.weekly_throughput(JIRA_URL, "dashboard@example.com", TOKEN, "payments")

    assert jira.call_count == 3
    assert [len(call.response.json()["issues"]) for call in jira.calls] == [15, 15, 15]
    assert all(call.request.headers["authorization"].startswith("Basic ") for call in jira.calls)
