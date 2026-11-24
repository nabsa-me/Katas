"""Flawed version: downloads everything on every run, inserts duplicates and fails halfway without a trace."""

import os
import sys

import httpx
import psycopg


def extract(jira_url: str, email: str, token: str, database_url: str) -> None:
    connection = psycopg.connect(database_url, autocommit=True)
    # No primary key: nothing stops the same issue from being inserted again.
    connection.execute(
        "CREATE TABLE IF NOT EXISTS jira_issues_copy (issue_key text, summary text, status text, updated text)"
    )
    next_page_token = None
    while True:
        # Always the whole project: no watermark, so every run downloads everything again.
        body = {"jql": "project in (PAY, WAL, PLT, MOB)", "fields": ["summary", "status", "updated"], "maxResults": 100}
        if next_page_token:
            body["nextPageToken"] = next_page_token
        # No status check and no retry: a 429 or a 500 body is read as if it were a page of results.
        data = httpx.post(jira_url + "/rest/api/3/search/jql", json=body, auth=(email, token)).json()
        for issue in data["issues"]:
            # Autocommit, one row at a time: a failure on page 2 leaves page 1 half-loaded behind it.
            connection.execute(
                "INSERT INTO jira_issues_copy VALUES (%s, %s, %s, %s)",
                (
                    issue["key"],
                    issue["fields"]["summary"],
                    issue["fields"]["status"]["name"],
                    issue["fields"]["updated"],
                ),
            )
        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break


def main() -> int:
    try:
        extract(
            os.environ["JIRA_BASE_URL"],
            os.environ["JIRA_EMAIL"],
            os.environ["JIRA_API_TOKEN"],
            os.environ["DATABASE_URL"],
        )
    except Exception:
        # The error, the page and the run are lost, and the scheduler sees a success.
        print("something went wrong")
    return 0


if __name__ == "__main__":
    sys.exit(main())
