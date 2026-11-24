# Jira Cloud REST client

## Statement

A nightly job reads the open issues of a Jira Cloud project and their comments. It was written against a demo project and looks like this:

```ts
const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify({ jql, fields }) /* … */ });
const data: any = await response.json();
return Promise.all(data.issues.map(async (issue: any) => /* fetch /issue/{key}/comment */));
```

Symptoms in production: the report only ever shows the first page of issues and nobody notices, some nights the job dies with `TypeError: Cannot read properties of undefined (reading 'map')`, and those nights Jira's logs show bursts of `429 Too Many Requests`. Replace it with a typed client that reads every page, survives rate limiting and never fires more than a few requests at once.

## What gets assessed

- Token pagination on `POST /rest/api/3/search/jql`: sending `nextPageToken` back until `isLast`, and exposing it as an async iterator.
- Rate limiting done right: retry only 429 and 503, `Retry-After` as the minimum delay, exponential backoff with jitter otherwise, a cap on attempts.
- A concurrency limit instead of `Promise.all` over hundreds of requests.
- Types at the boundary: responses validated with zod, typed errors, no `any`.
- Authentication: an API token over Basic auth, and what changes with OAuth 2.0 (3LO).

## How to approach it, step by step

1. Reproduce each symptom with a fake Jira (msw): three pages of issues, a 429 on a given request, and a counter of comment requests in flight.
2. Read the endpoint's contract: the response has `issues`, `nextPageToken` and `isLast`, and no `total` or `startAt`. Write the zod schema for the fields you request, and only those.
3. Write the pagination loop as an async generator that yields one page per request, then a second generator that yields issue by issue.
4. Write the retry decision as a pure function `(status, attempt, Retry-After, random) → delay | null` and test every rule without HTTP.
5. Wrap `fetch` in a `request()` that applies that function, with `sleep` and `random` injected so tests can assert the exact delays.
6. Write `mapWithConcurrency(items, limit, fn)` and use it for the per-issue requests; test the maximum in flight.
7. Turn non-retryable responses into a typed error that carries the status and Jira's messages.

## Solution explained

[`jira-client.ts`](./jira-client.ts) is the client, [`retry-policy.ts`](./retry-policy.ts) the pure retry rules, [`jira-schemas.ts`](./jira-schemas.ts) the zod schemas, and [`jira-client.problem.ts`](./jira-client.problem.ts) the flawed version. [`fake-jira.ts`](./fake-jira.ts) is the msw fake that [`jira-client.test.ts`](./jira-client.test.ts) runs both versions against; [`retry-policy.test.ts`](./retry-policy.test.ts) covers the rules one by one. The concurrency helper lives in [`src/lib/map-with-concurrency.ts`](../../lib/map-with-concurrency.ts).

**Token pagination.** The search endpoint pages with an opaque token, not with offsets. Each response may carry `nextPageToken`; the client sends it back in the next request body and stops when `isLast` is true or no token comes back:

```ts
do {
  const body = JSON.stringify({ jql, fields: ISSUE_FIELDS, maxResults: pageSize, nextPageToken });
  const page = searchPageSchema.parse(await request('/rest/api/3/search/jql', { method: 'POST', body }));
  yield page.issues;
  nextPageToken = page.isLast ? undefined : (page.nextPageToken ?? undefined);
} while (nextPageToken);
```

There is no `total`, so code ported from the old `/rest/api/3/search` endpoint (`startAt` + `total`, which Atlassian is removing) has to change its loop. The token is opaque (never build or parse it) and expires after 7 days. `maxResults` is a maximum, not a promise: Jira may return fewer issues, so the loop never decides "last page" by counting. The fake server returns 5 issues per page whatever `maxResults` says to prove it. The flawed version never sends the token, so it returns the first page and no error, which is the worst kind of bug.

**Async iterators.** `searchIssuePages()` is an `async function*`: the caller writes `for await (const issue of client.searchIssues(jql))` and pages are requested only when the loop needs them. Breaking out of the loop stops the requests (a test checks that only one page was requested). Memory stays flat however big the project is.

**Retrying the right things, for the right time.** [`retryDelayMs()`](./retry-policy.ts) decides, and it is pure:

- Only **429** (rate limited) and **503** (overloaded) are retried. A 400 is an invalid JQL, 401/403 credentials or permissions, 404 a missing issue: retrying them only burns rate limit. Atlassian also advises retrying only idempotent requests: the search is a `POST` but a read, so repeating it is safe. A `POST` that creates a comment is not.
- **`Retry-After` is the minimum delay.** Jira sends it in seconds on 429 (and on some 503s). The client waits at least that long, plus up to 30 % of jitter, so that every client throttled in the same second does not come back in the same second. If the server asks for longer than the policy accepts (60 s), the client fails instead of holding a job for an hour.
- **Without the header, exponential backoff with jitter:** 1 s, 2 s, 4 s, 8 s (capped at 30 s), each multiplied by a random factor between 0.7 and 1.3.
- **A cap:** 5 attempts in total, then a `JiraApiError` with the status and Jira's `errorMessages`.

Atlassian documents more headers than `Retry-After`: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-NearLimit` and `RateLimit-Reason` (global, tenant, burst or per-issue write quota). They are useful for logging and for slowing down before a 429; the retry decision only needs the status and `Retry-After`.

**Injected time.** The client takes `sleep` and `random`. Tests pass a `sleep` that records the delay and returns at once, and a fixed `random`, so "it honored `Retry-After: 2`" is the assertion `expect(sleeps).toEqual([2000])`, with no fake timers and no real waiting.

**A concurrency limit.** `Promise.all(keys.map(getComments))` starts every request at once: 300 issues are 300 simultaneous requests, which is exactly the burst rate limiters exist for. [`mapWithConcurrency()`](../../lib/map-with-concurrency.ts) starts `limit` workers; each takes the next item when it finishes the previous one, and the results keep the input order. The fake counts requests in flight: 5 at once for the flawed version (one per issue on its single page), never more than 4 for the client across all 12 issues. The comments endpoint still uses offset pagination (`startAt`, `maxResults`, `total`), so `getComments()` loops on `startAt` until it has `total` comments.

**Types at the boundary.** Responses are `unknown` until zod parses them. The schemas describe the requested fields only (`summary`, `status`, `assignee`, `updated`), with `assignee` nullable because unassigned issues come with `null`. A response that does not match throws a `ZodError` that names the field, instead of `undefined` travelling into a report. In the flawed version `any` hides all of this from the compiler; the root ESLint config flags it (`@typescript-eslint/no-explicit-any`), which is why the problem file has to disable the rule explicitly.

**Authentication.** With an API token, the header is `Basic base64(email:apiToken)` against `https://your-site.atlassian.net` ([`basicAuth()`](../../lib/basic-auth.ts)). With OAuth 2.0 (3LO), the token is a `Bearer` and the base URL changes to `https://api.atlassian.com/ex/jira/{cloudId}/…`, where `cloudId` comes from `GET https://api.atlassian.com/oauth/token/accessible-resources`; scopes such as `read:jira-work` limit what the app can do, and `offline_access` gives rotating refresh tokens. The client takes the base URL and the full `authorization` value, so both work unchanged. One trap is tested: `new URL('/rest/api/3/…', base)` drops the `/ex/jira/{cloudId}` prefix because the path starts with `/`, so the client concatenates instead.

## Common mistakes

| Symptom                                               | Cause                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Reports always show the same number of issues         | Only the first page is read: `nextPageToken` is never sent back.                                                  |
| An endless loop after moving to `/search/jql`         | The loop still waits for `total` or increments `startAt`, which the new endpoint does not use.                    |
| `TypeError` on `data.issues` some nights              | The status is not checked, so a 429 error body is parsed as a page of results.                                    |
| Retries make the throttling worse                     | Retrying immediately or with a fixed delay, ignoring `Retry-After`, or every client retrying at the same instant. |
| A job retries a 400 five times                        | Every error is retried; an invalid JQL will fail the same way every time.                                         |
| 429 bursts when fetching details for many issues      | `Promise.all` over every issue instead of a concurrency limit.                                                    |
| 404 on every request with OAuth                       | The base URL lost `/ex/jira/{cloudId}`, or a site URL is used with a `Bearer` token.                              |
| `undefined` in the report for a field that is present | The field was not in `fields`, so Jira did not return it; `any` hid it from the compiler.                         |

## Practice

Add `searchIssueCount(jql)` with `POST /rest/api/3/search/approximate-count`, and make `request()` log a warning when a response carries `X-RateLimit-NearLimit`, with a test for each.
