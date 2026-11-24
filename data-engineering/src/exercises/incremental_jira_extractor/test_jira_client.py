from collections.abc import Iterator
from datetime import UTC, datetime

import httpx
import pytest
import respx
from tenacity import wait_exponential

from exercises.incremental_jira_extractor.fake_jira import BASE_URL, FakeJira
from exercises.incremental_jira_extractor.jira_client import (
    FIELDS,
    SEARCH_PATH,
    JiraApiError,
    JiraClient,
    SourceUnavailableError,
    parse_retry_after,
)

NOW = datetime(2026, 11, 24, 6, 0, tzinfo=UTC)


@pytest.fixture
def router() -> Iterator[respx.MockRouter]:
    with respx.mock(base_url=BASE_URL) as router:
        yield router


@pytest.fixture
def fake(router: respx.MockRouter) -> FakeJira:
    fake = FakeJira(now=NOW)
    router.post(SEARCH_PATH, name="search").mock(side_effect=fake)
    return fake


@pytest.fixture
def sleeps() -> list[float]:
    return []


@pytest.fixture
def client(sleeps: list[float]) -> Iterator[JiraClient]:
    # Deterministic backoff (1 s, 2 s, 4 s…) and a sleep that records instead of waiting.
    with httpx.Client(base_url=BASE_URL) as http:
        yield JiraClient(http, backoff=wait_exponential(multiplier=1, max=30), sleep=sleeps.append)


def test_reads_every_page_sending_the_token_back(fake: FakeJira, client: JiraClient) -> None:
    pages = list(client.search_pages("project = PAY", page_size=10))

    assert [len(page) for page in pages] == [10, 10, 10, 1]
    assert len({issue.key for page in pages for issue in page}) == 31
    assert [request.get("nextPageToken") for request in fake.requests] == [None, "page-2", "page-3", "page-4"]
    assert fake.requests[0]["fields"] == FIELDS
    assert fake.requests[0]["maxResults"] == 10


def test_requests_the_next_page_only_when_the_caller_needs_it(fake: FakeJira, client: JiraClient) -> None:
    first = next(client.search_pages("project = PAY", page_size=10))

    assert len(first) == 10
    assert len(fake.requests) == 1


def test_flattens_nested_fields_and_keeps_timezone_offsets(fake: FakeJira, client: JiraClient) -> None:
    issues = {issue.key: issue for page in client.search_pages("project = PAY", 10) for issue in page}

    refund = issues["PAY-102"]  # Jira sent this one with a +0100 offset
    assert (refund.project_key, refund.status, refund.status_category, refund.issue_type) == (
        "PAY",
        "Done",
        "done",
        "Story",
    )
    assert refund.assignee_account_id == "account-sam"
    assert refund.resolved == datetime(2026, 10, 30, 11, 20, tzinfo=UTC)
    assert issues["PAY-111"].assignee_account_id is None  # unassigned: `"assignee": null`
    assert issues["PAY-111"].resolved is None


def test_honors_retry_after_as_the_minimum_delay(fake: FakeJira, client: JiraClient, sleeps: list[float]) -> None:
    fake.failures[1].append(httpx.Response(429, headers={"Retry-After": "7"}))

    pages = list(client.search_pages("project = PAY", 10))

    assert len(pages) == 4
    assert sleeps == [7.0]


def test_backs_off_exponentially_without_retry_after(fake: FakeJira, client: JiraClient, sleeps: list[float]) -> None:
    fake.failures[2].extend(
        [httpx.Response(503), httpx.Response(502), httpx.Response(429, headers={"Retry-After": "1"})]
    )

    list(client.search_pages("project = PAY", 10))

    # The backoff (1, 2, 4) wins when Retry-After asks for less.
    assert sleeps == [1.0, 2.0, 4.0]


def test_retries_network_errors(
    router: respx.MockRouter, fake: FakeJira, client: JiraClient, sleeps: list[float]
) -> None:
    attempts = 0

    def refuse_first_connection(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("connection refused", request=request)
        return fake(request)

    router.routes["search"].mock(side_effect=refuse_first_connection)
    pages = list(client.search_pages("project = PAY", 10))

    assert len(pages) == 4
    assert sleeps == [1.0]


def test_does_not_retry_an_answer_that_cannot_change(fake: FakeJira, client: JiraClient, sleeps: list[float]) -> None:
    fake.failures[1].append(httpx.Response(400, json={"errorMessages": ["Error in the JQL Query"]}))

    with pytest.raises(JiraApiError, match="400") as raised:
        list(client.search_pages("project = = PAY", 10))

    assert raised.value.status == 400
    assert len(fake.requests) == 1
    assert sleeps == []


def test_gives_up_after_five_attempts(fake: FakeJira, client: JiraClient, sleeps: list[float]) -> None:
    fake.failing_forever.add(1)

    with pytest.raises(SourceUnavailableError, match="5 attempts"):
        list(client.search_pages("project = PAY", 10))

    assert len(fake.requests) == 5
    assert sleeps == [1.0, 2.0, 4.0, 8.0]


@pytest.mark.parametrize(("header", "seconds"), [("30", 30.0), ("0", 0.0), (None, None), ("soon", None)])
def test_parses_retry_after_in_seconds(header: str | None, seconds: float | None) -> None:
    assert parse_retry_after(header) == seconds
