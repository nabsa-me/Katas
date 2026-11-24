"""Flawed version: the dashboard page calls Jira itself and computes throughput with its own definition."""

import os
import sys
from collections import Counter
from datetime import datetime, timedelta

import httpx

# A hand-kept copy of the dbt seed `team_projects.csv`: the day a project moves, this page and the mart disagree.
TEAM_PROJECTS = {"payments": "PAY, WAL", "platform": "PLT", "mobile": "MOB"}


def weekly_throughput(jira_url: str, email: str, token: str, team: str) -> dict[str, int]:
    """Throughput as this page defines it: issues in status "Done", in the week of their last update."""
    weeks: Counter[str] = Counter()
    next_page_token = None
    while True:
        # Every page view downloads the team's whole history from Jira again, with a Jira token held by the app.
        body = {"jql": f"project in ({TEAM_PROJECTS[team]})", "fields": ["status", "updated"], "maxResults": 100}
        if next_page_token:
            body["nextPageToken"] = next_page_token
        data = httpx.post(jira_url + "/rest/api/3/search/jql", json=body, auth=(email, token)).json()
        for issue in data["issues"]:
            # `Closed` is a done status too, and `updated` moves whenever anyone touches an old issue.
            if issue["fields"]["status"]["name"] == "Done":
                updated = datetime.strptime(issue["fields"]["updated"], "%Y-%m-%dT%H:%M:%S.%f%z")
                monday = updated.date() - timedelta(days=updated.weekday())
                weeks[monday.isoformat()] += 1
        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break
    return dict(sorted(weeks.items()))


def render(team: str, weeks: dict[str, int]) -> str:
    return "\n".join([f"{team}: issues resolved per week", *(f"{week}  {count}" for week, count in weeks.items())])


def main() -> int:
    team = sys.argv[1] if len(sys.argv) > 1 else "payments"
    jira = (os.environ["JIRA_BASE_URL"], os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])
    print(render(team, weekly_throughput(*jira, team)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
