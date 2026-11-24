# Atlassian GraphQL: Goals and Teams

## Statement

A sync job reads the company goals of Atlassian Goals through the Atlassian GraphQL API, to show them next to Jira data. It was written as if GraphQL were REST:

```ts
if (!response.ok) throw new Error(`GraphQL request failed with ${response.status}`);
const body: any = await response.json();
return body.data.goals_search.edges.map((edge: any) => edge.node);
```

Symptoms: only the first 25 goals ever appear; some goals show "no owner" although they have one; and when the API token lacks a permission, the job dies with `TypeError: Cannot read properties of null (reading 'goals_search')` instead of saying what is wrong. Rewrite it so it reads every page, keeps the valid data of a partial response and reports every error with its path. Teams come next, through the same client.

## What gets assessed

- Knowing that GraphQL reports errors in the body (`errors`), usually with HTTP 200, and that `data` and `errors` can arrive together.
- Relay cursor pagination: `first` / `after`, `pageInfo.hasNextPage` / `endCursor`.
- Validating a partial response: which fields can be `null` because of an error, and keeping the rest.
- Separating transport failures (401, 429, 5xx, an HTML page) from GraphQL errors, including Atlassian's timestamp `RETRY-AFTER`.
- Sending values as variables, and telling verified API surface from assumptions.

## How to approach it, step by step

1. Fake the API with msw (`graphql.link(endpoint).query('GoalsSearch', …)`): two pages of goals, a page where one field is `null` with an entry in `errors`, and a response with `data: null`.
2. Split the client in two: a generic `execute(query, variables)` that returns `{ data, errors }`, and a `searchGoals()` that knows the query, its schema and its pagination.
3. In `execute`, decide by the body: if it is a GraphQL envelope (`data` or `errors`), return it whatever the status; otherwise it is a transport failure and it throws.
4. Handle 429 apart: wait until the `RETRY-AFTER` timestamp (with `now` and `sleep` injected), cap the attempts, and never retry 5xx.
5. Write the zod schema with every field an error could null as nullable, and loop on `endCursor` while `hasNextPage` is true.
6. Accumulate the errors of every page and return them next to the goals, with a flag that says whether every page was read.

## Solution explained

[`graphql-client.ts`](./graphql-client.ts) is the generic client, [`goals.ts`](./goals.ts) the goals query and its pagination, [`teams-query.ts`](./teams-query.ts) the illustrative Teams query, and [`goals.problem.ts`](./goals.problem.ts) the flawed version. [`goals.test.ts`](./goals.test.ts) runs both versions against a fake Goals API built with `msw/graphql`; [`graphql-client.test.ts`](./graphql-client.test.ts) covers the transport rules.

**Errors live in the body.** A GraphQL server answers one HTTP request for a whole document of fields. If one field fails, the others can still resolve, so the response says "here is what I could do" (`data`) and "here is what failed" (`errors`, each with a `message`, a `path` to the failing field and often `extensions`). Atlassian documents it for missing scopes: the field comes back `null` and a matching entry appears in `errors`, while the other authorized fields still resolve. `response.ok` is true, so the flawed version's status check never fires; it then returns a goal whose `owner` is `null` with nothing to tell "no owner" from "owner not readable".

**`execute` decides by the body, not by the status.** It parses the text and, if it is a GraphQL envelope, returns `{ data, errors }` as they are, even with a 4xx status (some servers answer validation errors that way). Only a body that is not GraphQL (an `Unauthorized` text, a gateway's HTML page) becomes a `GraphqlHttpError`. Which status Atlassian uses when a response carries both `data` and `errors` is not documented in the pages checked (see "Not verified" below), and this design does not need to know it.

**Partial data, typed.** In [`goals.ts`](./goals.ts) the schema marks as nullable everything an error can null: `status`, `owner`, `targetDate`, each edge, each node and `goals_search` itself. Only `id` and `name` are required to keep a goal. `searchGoals()` then:

- adds each page's `errors` to the result, so a missing owner comes with `path: ['goals_search', 'edges', 1, 'node', 'owner']`;
- stops when `data` or `goals_search` is `null`, keeping the goals of the pages already read and setting `allPagesRead: false`;
- reports a response that matches no known shape as one more error, instead of throwing it away or crashing.

The caller decides what is acceptable: a dashboard can show partial goals with a warning, a billing job should refuse them.

**Cursor pagination.** The Goals API follows the Relay connection pattern: ask for `first: n`, and while `pageInfo.hasNextPage` is true, send `pageInfo.endCursor` back as `after`. The cursor is opaque. The test checks that the second request carries the first page's `endCursor`.

**Variables, not string building.** The query declares `$containerId`, `$searchString`, `$first` and `$after`, and the values travel in `variables`. Interpolating user input into the query text opens the door to injection, breaks on quotes, and turns every request into a different document for the server to parse. The field `goals_search`, its arguments (`containerId` as `ari:cloud:townsquare::site/{siteId}`, `searchString` such as `status = on_track`, `first`, `after`, `sort: [NAME_ASC]`) and the selection are the ones in Atlassian's examples. Those examples write the values inline, so the variable types are the part to confirm.

**Rate limiting is HTTP, and the date is a timestamp.** Atlassian applies rate limits to the whole request: HTTP 429, never an entry in `errors`. The `RETRY-AFTER` header is an ISO 8601 timestamp such as `2026-05-10T11:00Z`, not the number of seconds or the HTTP date that generic retry code expects. [`retryAfterDelayMs()`](./graphql-client.ts) accepts all three and returns the wait from an injected `now()`, so the test asserts that a timestamp 30 s ahead produces `sleep(30000)`. Atlassian also asks clients not to retry 5xx, so the client fails at once on them.

**Endpoints and auth.** With an API token: `POST https://your-site.atlassian.net/gateway/api/graphql` with `Authorization: Basic base64(email:token)`. With OAuth: `POST https://api.atlassian.com/graphql` with a `Bearer` token and scopes such as `read:goal:goals`. Experimental fields need an opt-in: the directive `@optIn(to: "Townsquare")` in the Goals examples, or the `X-ExperimentalApi` header for beta fields.

**Teams, marked as unverified.** What is verified: teams are searched under `team { teamSearchV2(…) }` (a `teamSearchV3` exists too) and `siteId` is mandatory. The rest of [`teams-query.ts`](./teams-query.ts) follows the Relay pattern and is marked ⚠️ in the code. Paging, partial errors and rate limiting work exactly as for goals; only the query and its schema change. A test parses both queries with `graphql`'s `parse`, which proves they are valid documents, not that the schema accepts them.

### Not verified

- ⚠️ Verify: the variable types declared in `GOALS_SEARCH_QUERY` (`ID!`, `String!`, `Int`, `String`). If one differs, the API answers a validation error naming the expected type. Check them in the GraphQL Explorer linked from https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/
- ⚠️ Verify: the arguments and result shape of `teamSearchV2` in [`teams-query.ts`](./teams-query.ts): https://developer.atlassian.com/platform/teams/teams-graphql-api/introduction/
- ⚠️ Verify: the HTTP status of a response that carries both `data` and `errors` (the client does not depend on it): https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/

## Common mistakes

| Symptom                                        | Cause                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Errors never reach the logs                    | Only `response.ok` is checked; GraphQL errors come in the body with a 200.                                   |
| `TypeError: Cannot read properties of null`    | `data` (or the root field) is `null` because of an error, and the code reads it without looking at `errors`. |
| Fields are `null` and nobody knows why         | `errors` is discarded, so "no value" and "not readable" look the same.                                       |
| The whole sync fails because one field failed  | Throwing whenever `errors` is non-empty; partial data is often still useful, and the caller should decide.   |
| Always the same number of results              | `pageInfo.hasNextPage` is ignored; only the first page is read.                                              |
| Retries hammer the API during an outage        | 5xx retried in a loop, or `RETRY-AFTER` read as seconds when it is a timestamp.                              |
| A quote in a search string breaks the request  | Values interpolated into the query text instead of sent as variables.                                        |
| A request with experimental fields is rejected | Experimental or beta fields used without `@optIn(to: "Townsquare")` or the `X-ExperimentalApi` header.       |

## Practice

Add `searchGoalsByIds(ids)` with `goals_byIds`, and make `searchGoals()` take an `onPartial: 'keep' | 'fail'` option that turns any error into an exception, with a test for each mode.
