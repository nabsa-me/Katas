"""A fake Jira search endpoint for respx: token pages, the relative `updated` bound, and scripted failures."""

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import httpx

from lib.sample_issues import sample_issues

BASE_URL = "https://example.atlassian.net"
RELATIVE_BOUND = re.compile(r'updated >= "-(\d+)m"')


class FakeJira:
    """Serves the fictional issues sorted by `updated`, `page_size` at a time, as of `now`."""

    def __init__(self, now: datetime, page_size: int = 10) -> None:
        self.now = now
        self.page_size = page_size
        self.issues = sample_issues()
        self.requests: list[dict[str, Any]] = []
        # Page number → responses to return, in order, before serving the page normally.
        self.failures: dict[int, list[httpx.Response]] = defaultdict(list)
        self.failing_forever: set[int] = set()

    def update_issue(self, key: str, **fields: Any) -> None:
        issue = next(issue for issue in self.issues if issue["key"] == key)
        issue["fields"].update(fields)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        token = body.get("nextPageToken")
        page = int(token.removeprefix("page-")) if token else 1
        if page in self.failing_forever:
            return httpx.Response(500, json={"errorMessages": ["Internal server error"]})
        if self.failures[page]:
            return self.failures[page].pop(0)
        return httpx.Response(200, json=self._page(body["jql"], page))

    def _page(self, jql: str, page: int) -> dict[str, Any]:
        matching = sorted(self.issues, key=lambda issue: (_parse(issue["fields"]["updated"]), issue["key"]))
        bound = RELATIVE_BOUND.search(jql)
        if bound:
            since = self.now - timedelta(minutes=int(bound.group(1)))
            matching = [issue for issue in matching if _parse(issue["fields"]["updated"]) >= since]
        start = (page - 1) * self.page_size
        issues = matching[start : start + self.page_size]
        is_last = start + self.page_size >= len(matching)
        return {"issues": issues, "isLast": is_last} | ({} if is_last else {"nextPageToken": f"page-{page + 1}"})


def _parse(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%f%z")
