from datetime import date

import httpx
import psycopg
import pytest

from exercises.thin_client_governed_data.metrics_api import MART, MartThroughputSource, WeeklyThroughput, make_app

PATH = "/metrics/team-weekly-throughput"
DESCRIPTION = "Done issues per team, in the week they were resolved."
ROWS = [
    WeeklyThroughput("payments", "Payments", date(2026, 11, 9), 3),
    WeeklyThroughput("payments", "Payments", date(2026, 11, 16), 4),
    WeeklyThroughput("mobile", "Mobile", date(2026, 11, 16), 2),
]


class StubSource:
    """Stands in for the mart; records which team each request asked for."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.requested: list[str | None] = []

    def describe(self) -> str:
        if self.error:
            raise self.error
        return DESCRIPTION

    def weekly_throughput(self, team_id: str | None) -> list[WeeklyThroughput]:
        self.requested.append(team_id)
        return [row for row in ROWS if team_id is None or row.team_id == team_id]


def client_for(source: StubSource | MartThroughputSource) -> httpx.Client:
    """The API called in-process: no server, no port."""
    return httpx.Client(transport=httpx.WSGITransport(app=make_app(source)), base_url="http://metrics.test")


def test_serves_the_rows_and_their_definition_as_they_are() -> None:
    source = StubSource()
    with client_for(source) as client:
        response = client.get(PATH, params={"team": "payments"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "metric": {"name": "team_weekly_throughput", "description": DESCRIPTION, "source": MART},
        "data": [
            {"team_id": "payments", "team_name": "Payments", "week_start": "2026-11-09", "resolved_issues": 3},
            {"team_id": "payments", "team_name": "Payments", "week_start": "2026-11-16", "resolved_issues": 4},
        ],
    }
    assert source.requested == ["payments"]


def test_without_a_team_it_serves_every_team() -> None:
    source = StubSource()
    with client_for(source) as client:
        data = client.get(PATH).json()["data"]

    assert len(data) == 3
    assert source.requested == [None]


def test_the_catalog_lists_each_metric_with_its_definition() -> None:
    with client_for(StubSource()) as client:
        [metric] = client.get("/metrics").json()["metrics"]

    assert (metric["name"], metric["description"], metric["path"]) == ("team_weekly_throughput", DESCRIPTION, PATH)


@pytest.mark.parametrize("team", ["", "PAY", "payments'; DROP TABLE teams; --"])
def test_a_team_that_is_not_a_team_id_is_a_400(team: str) -> None:
    source = StubSource()
    with client_for(source) as client:
        response = client.get(PATH, params={"team": team})

    assert response.status_code == 400
    assert source.requested == []


def test_unknown_paths_are_404_and_writes_are_405() -> None:
    with client_for(StubSource()) as client:
        assert client.get("/metrics/velocity").status_code == 404
        refused = client.post(PATH, json={"resolved_issues": 99})

    assert refused.status_code == 405
    assert refused.headers["allow"] == "GET"


def test_an_unavailable_store_is_a_503_never_a_number_computed_another_way() -> None:
    with client_for(StubSource(error=psycopg.OperationalError("connection refused"))) as client:
        response = client.get(PATH, params={"team": "payments"})

    assert response.status_code == 503
    assert response.json() == {"error": "Metrics store unavailable"}


def test_serves_the_mart_that_dbt_built_with_the_description_dbt_stored(database_url: str, dbt_build: object) -> None:
    with client_for(MartThroughputSource(database_url)) as client:
        body = client.get(PATH, params={"team": "payments"}).json()

    description = body["metric"]["description"]
    assert description.startswith("Issue throughput per team per week: issues whose status category is done")
    assert description.endswith("The only definition of this metric.")
    weeks = [(row["week_start"], row["resolved_issues"]) for row in body["data"]]
    assert weeks == [("2026-10-26", 3), ("2026-11-02", 2), ("2026-11-09", 3), ("2026-11-16", 4)]


def test_the_mart_source_cannot_write(database_url: str, dbt_build: object) -> None:
    with (
        MartThroughputSource(database_url).connect() as connection,
        pytest.raises(psycopg.errors.ReadOnlySqlTransaction),
    ):
        connection.execute(f"DELETE FROM {MART}")
