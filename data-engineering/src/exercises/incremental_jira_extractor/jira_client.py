"""Jira Cloud search: token pagination, typed issues and retries that honor `Retry-After`."""

import time
from collections.abc import Callable, Iterator
from datetime import datetime
from typing import Any

import httpx
import structlog
from pydantic import AliasPath, BaseModel, Field
from tenacity import RetryCallState, RetryError, Retrying, retry_if_exception_type, stop_after_attempt
from tenacity.wait import wait_base, wait_exponential_jitter

SEARCH_PATH = "/rest/api/3/search/jql"
FIELDS = ["summary", "status", "issuetype", "project", "assignee", "created", "updated", "resolutiondate"]
# Rate limited, or a server-side failure that a later attempt can survive.
RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})


def _field(*path: str) -> Any:
    """A flat attribute read from a nested Jira path; missing or null along the way gives `None`."""
    return Field(default=None, validation_alias=AliasPath("fields", *path))


class JiraIssue(BaseModel):
    """The requested fields only. They may be missing: the data quality checks decide what a batch must have."""

    key: str
    project_key: str | None = _field("project", "key")
    summary: str | None = _field("summary")
    status: str | None = _field("status", "name")
    status_category: str | None = _field("status", "statusCategory", "key")
    issue_type: str | None = _field("issuetype", "name")
    assignee_account_id: str | None = _field("assignee", "accountId")
    created: datetime | None = _field("created")
    updated: datetime | None = _field("updated")
    resolved: datetime | None = _field("resolutiondate")


class SearchPage(BaseModel):
    issues: list[JiraIssue]
    next_page_token: str | None = Field(default=None, alias="nextPageToken")
    is_last: bool = Field(default=False, alias="isLast")


class JiraApiError(Exception):
    """An answer that retrying cannot fix (400 invalid JQL, 401/403 credentials, 404)."""

    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"Jira answered {status}: {body[:300]}")
        self.status = status


class RetryableResponseError(Exception):
    def __init__(self, status: int, retry_after: float | None) -> None:
        super().__init__(f"Jira answered {status}")
        self.status = status
        self.retry_after = retry_after


class SourceUnavailableError(Exception):
    """Jira kept failing after every attempt; the run stops without moving the watermark."""


def parse_retry_after(value: str | None) -> float | None:
    """Jira sends whole seconds. Anything else is ignored and the backoff decides."""
    try:
        return max(float(value), 0.0) if value is not None else None
    except ValueError:
        return None


class JiraClient:
    def __init__(
        self,
        http: httpx.Client,
        *,
        attempts: int = 5,
        backoff: wait_base | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        """`http` carries the base URL, Basic auth and timeouts; `backoff` and `sleep` are injected by tests."""
        self._http = http
        self._attempts = attempts
        self._backoff = backoff or wait_exponential_jitter(max=30, jitter=1)
        self._sleep = sleep
        self._log = structlog.get_logger()

    def search_pages(self, jql: str, page_size: int) -> Iterator[list[JiraIssue]]:
        """One list per page, requested only when the caller asks for the next one."""
        token: str | None = None
        while True:
            body: dict[str, Any] = {"jql": jql, "fields": FIELDS, "maxResults": page_size}
            if token:
                body["nextPageToken"] = token
            page = SearchPage.model_validate(self._post(SEARCH_PATH, body))
            yield page.issues
            token = None if page.is_last else page.next_page_token
            if not token:
                return

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        # The search is a POST but a read: repeating it is safe, so it can be retried.
        retrying = Retrying(
            stop=stop_after_attempt(self._attempts),
            wait=self._wait,
            retry=retry_if_exception_type((RetryableResponseError, httpx.TransportError)),
            sleep=self._sleep,
            before_sleep=self._log_retry,
        )
        try:
            return retrying(self._post_once, path, body)
        except RetryError as error:
            cause = error.last_attempt.exception()
            raise SourceUnavailableError(f"Jira still failing after {self._attempts} attempts: {cause}") from cause

    def _post_once(self, path: str, body: dict[str, Any]) -> Any:
        response = self._http.post(path, json=body)
        if response.status_code in RETRYABLE_STATUSES:
            raise RetryableResponseError(response.status_code, parse_retry_after(response.headers.get("Retry-After")))
        if response.is_error:
            raise JiraApiError(response.status_code, response.text)
        return response.json()

    def _wait(self, state: RetryCallState) -> float:
        """`Retry-After` is the minimum; without it, exponential backoff with jitter."""
        backoff = self._backoff(state)
        error = state.outcome.exception() if state.outcome else None
        if isinstance(error, RetryableResponseError) and error.retry_after is not None:
            return max(error.retry_after, backoff)
        return backoff

    def _log_retry(self, state: RetryCallState) -> None:
        error = state.outcome.exception() if state.outcome else None
        wait = state.next_action.sleep if state.next_action else None
        self._log.warning("jira_retry", attempt=state.attempt_number, error=str(error), wait_seconds=wait)
