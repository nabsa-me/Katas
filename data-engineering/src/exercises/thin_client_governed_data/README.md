# App as a thin client of the governed data layer

## Statement

The team dashboard shows how many issues each team resolves per week. It was built quickly: the page calls Jira's search itself, keeps its own copy of which projects belong to which team, and computes the KPI on the spot:

```python
TEAM_PROJECTS = {"payments": "PAY, WAL", "platform": "PLT", "mobile": "MOB"}
...
data = httpx.post(jira_url + "/rest/api/3/search/jql", json=body, auth=(email, token)).json()
for issue in data["issues"]:
    if issue["fields"]["status"]["name"] == "Done":
        updated = datetime.strptime(issue["fields"]["updated"], "%Y-%m-%dT%H:%M:%S.%f%z")
        weeks[monday_of(updated)] += 1
```

Symptoms: the dashboard says Payments resolved 9 issues in four weeks, the weekly report built on the dbt mart says 12, and both read the same Jira data. Every page view downloads the team's whole history from Jira again, with a Jira token held by the app, and the morning everybody opens the dashboard the searches run into Jira's rate limits. Turn the page into a thin client: it asks an API that serves the governed metric (the mart of the previous exercise, with its definition) and only presents the answer.

## What gets assessed

- Where a metric's definition lives: once, in the data layer, versioned and tested, not in every application.
- A read-only metrics API that serves the mart as it is, with the definition next to the numbers.
- A thin client: fetch, validate at the boundary, format. No business rules, no source credentials.
- Proving the cost of the alternative: the same data and a second definition give different numbers.
- Where a semantic layer (dbt Semantic Layer, Cube) takes over from a hand-written API.

## How to approach it, step by step

1. Reproduce the disagreement: run the page's calculation and query the mart over the same fictional issues, week by week, and explain every difference.
2. List what the page decides on its own: which statuses count, which date, which week, which projects belong to which team. Each of those is already decided, and tested, in the dbt project.
3. Design the API around the mart's grain: one route per metric, filters that match the mart's columns (`team`), the metric's name, definition and source in every response, and a catalog route.
4. Keep the API read-only and dumb: `SELECT` from the mart, no aggregation, and no fallback to Jira when the warehouse is down.
5. Write the client: one request, a pydantic model for the response, a render function that only formats.
6. Remove everything Jira from the application: the token, the project mapping, the extraction.
7. Test the API with a stub source and with the real mart, the client against a mocked API, and the problem against a mocked Jira.

## Solution explained

[`metrics_api.py`](./metrics_api.py) is the API, [`dashboard.py`](./dashboard.py) the thin client and [`dashboard.problem.py`](./dashboard.problem.py) the flawed page. The tests are [`test_metrics_api.py`](./test_metrics_api.py) and [`test_dashboard.py`](./test_dashboard.py); the ones that need the mart use the warehouse that the session builds once with `dbt build` (the `dbt_build` fixture in [`src/conftest.py`](../../conftest.py)).

**Why the numbers differ.** Same 15 Payments issues (projects `PAY` and `WAL`), two definitions:

| Week (Monday) | Mart | Page | Why                                                                                        |
| ------------- | ---- | ---- | ------------------------------------------------------------------------------------------ |
| 2026-10-26    | 3    | 3    | Same: three `Done` issues, resolved and last updated that week                             |
| 2026-11-02    | 2    | 1    | PAY-104 is `Closed`: done by status category, not by `status.name == "Done"`               |
| 2026-11-09    | 3    | 1    | WAL-203 is `Closed`, and PAY-106 was resolved here but counted in its last update week     |
| 2026-11-16    | 4    | 3    | WAL-204 is `Closed`                                                                        |
| 2026-11-23    | none | 1    | PAY-106, updated on 23 November long after it was resolved; nothing was resolved that week |

Neither number is a bug in the arithmetic: each is a different definition, and that is the problem. A KPI computed inside each application has as many definitions as there are applications, and nobody can say which one is right. The governed definition is written once, in the dbt model `int_resolved_issues_by_team`, reviewed in pull requests and tested on every build.

**Why a thin client.**

- **One definition.** Changing the rule is one pull request on the dbt project; every consumer gets the new numbers at the next build, and they all agree.
- **No duplicated extraction.** The nightly extractor reads Jira once, incrementally. The page downloaded the team's whole history on every view, multiplying calls to a rate-limited API by users and views.
- **No source credentials in the application.** The dashboard holds no Jira token and needs no Jira network access; it reads the API, and the API reads marts only.
- **The same answer everywhere.** A dashboard, a notebook, a Slack digest or an AI assistant ask the same endpoint and get the same number. Caching and access control live in one place.

**The API serves, it does not compute.** [`MartThroughputSource`](./metrics_api.py) only selects:

```sql
SELECT team_id, team_name, week_start, resolved_issues FROM analytics_marts.fct_team_weekly_throughput
WHERE %(team)s::text IS NULL OR team_id = %(team)s
ORDER BY team_id, week_start
```

No `count`, no `GROUP BY`, no `CASE`. If a number needs a calculation, it belongs in a dbt model with tests, and the API serves the new mart. The connection sets `default_transaction_read_only=on`, so an accidental write fails even if the role could write. It is a guard, not the security boundary (a session can turn it off): that is a database role with `SELECT` on the marts schema only. The API depends on a `ThroughputSource` protocol, so the tests can replace the database with a stub.

**The definition travels with the numbers.** The previous exercise's `persist_docs` stores the mart's model description as the table's Postgres comment; `describe()` reads it with `obj_description(...)`, and every response carries it:

```json
{
  "metric": {
    "name": "team_weekly_throughput",
    "description": "Issue throughput per team per week: issues whose status category is done, …",
    "source": "analytics_marts.fct_team_weekly_throughput"
  },
  "data": [{ "team_id": "payments", "team_name": "Payments", "week_start": "2026-11-16", "resolved_issues": 4 }]
}
```

The description is written in the dbt project, next to the SQL it describes, and nowhere else. The dashboard prints it under the chart, so whoever reads the number can see what it counts. `GET /metrics` lists every metric with its definition and path.

**Routes and errors.** A plain WSGI application ([PEP 3333](https://peps.python.org/pep-3333/)) from the standard library, so the whole contract fits in one function. `GET /metrics` and `GET /metrics/team-weekly-throughput[?team=<id>]`; 400 for a `team` that is not a team id (checked with a regular expression before it reaches the query, which is parameterized anyway); 404 for an unknown path; 405 with `Allow: GET` for any other method; 503 when the warehouse is down or the mart has not been built. The 503 matters: the API never "helps" by computing the number some other way.

**The client fetches, validates and formats.** [`fetch_team_throughput`](./dashboard.py) sends one request and validates the body with pydantic (`ThroughputReport`): `resolved_issues` must be a non-negative integer and `week_start` a date, so a payload that breaks the contract raises instead of being drawn. Unknown fields are ignored (pydantic's default), so the API can add fields without breaking its clients. `render` only formats: one line per week with a bar of `#`, the number, then the definition and the source. ASCII only, so any console prints it.

**No port: the API runs in-process.** `metrics_client()` returns an `httpx.Client` on `METRICS_API_URL` when it is set (a deployed API). Without it, it wraps the same WSGI application in `httpx.WSGITransport`: httpx calls the application as a function, with real HTTP semantics (method, path, query string, status, headers) but no server and no port. The tests use the same transport. The client's contract with the API is the path and the JSON shape; the import of `make_app` in `dashboard.py` exists only for that local wiring.

**How it is proven.** `test_metrics_api.py`, with a stub source: the exact response for one team and the team passed through, every team without the parameter, the catalog, 400 for `""`, `PAY` and an injection attempt without the source being called, 404, 405 with `Allow: GET`, and 503 when the store raises. Against the mart that dbt built in the session: Payments' four weeks (3, 2, 3, 4) and the description dbt stored, and a `DELETE` through the API's connection fails with `ReadOnlySqlTransaction`. `test_dashboard.py`, with the metrics API mocked by respx (any other request fails the test): one request and the exact rendered lines, four broken payloads rejected with `ValidationError`, `main()` with only `DATABASE_URL` in its environment printing the mart's numbers and definition through the in-process API, and a 503 ending in exit code 1 with a message. The problem, against a respx Jira serving the same fictional issues: the page computes 3, 1, 1, 3, 1 (9 issues, one of them in a week the mart does not have) where the mart has 3, 2, 3, 4 (12), and three views download the team's 15 issues from Jira three times, each with Basic credentials.

**From a hand-written API to a semantic layer.** This API serves one metric at one grain. When consumers need other grains or slices (per month, per issue type, a ratio of two metrics), a semantic layer such as the dbt Semantic Layer (MetricFlow) or Cube generates those queries from definitions declared once, and its API replaces this module. The client's side stays the same: ask for a metric by name, present the answer. The [dbt basics README](../dbt_basics/README.md) explains what each of them adds.

## Common mistakes

| Symptom                                                | Cause                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Two dashboards show different numbers for the same KPI | Each application computes it with its own rules (status name or category, updated or resolved date).       |
| A KPI drops after a workflow change in Jira            | The application filters on status names; a new done status (`Closed`, `Released`) silently stops counting. |
| Jira rate limits when everyone opens the dashboard     | The page extracts from the source on every view instead of reading data extracted once.                    |
| A Jira token in the dashboard's configuration          | The application talks to the source; a client of a governed API needs no source credentials.               |
| A team's numbers change when a project is reassigned   | A hand-kept copy of the team-to-project mapping in the application, out of date.                           |
| The API "fixes" a number with its own SQL              | Business logic in the serving layer: move it to a dbt model with tests and serve the new mart.             |
| The client breaks when the API adds a field            | Validation that forbids unknown fields; validate the fields you use and ignore the rest.                   |
| A wrong number on screen while the warehouse is down   | A fallback that computes it from the source; answer 503 and show that the metric is unavailable.           |
| Nobody knows what a number counts                      | The definition exists only as SQL; serve it with the numbers (persisted docs, a catalog route).            |

## Practice

Add a second governed metric, open issues per team at the end of each week, as a new dbt mart with its own tests and description, list it in `GET /metrics`, and render it in the dashboard by changing only the path it asks for.
