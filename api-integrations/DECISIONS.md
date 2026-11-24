# Decisions

## Versions

| Package / tool        | Version | Verified against                                                                                                                                          |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js               | 22.12+  | `engines` of msw 3 (`node_modules/msw/package.json`); developed on Node 24                                                                                |
| TypeScript            | 6.0.3   | `node_modules/typescript/package.json`                                                                                                                    |
| Vitest                | 5.1.1   | `node_modules/vitest/package.json`                                                                                                                        |
| msw                   | 3.0.7   | `node_modules/msw/package.json`, https://mswjs.io/docs/migrations/2.x-to-3.x                                                                              |
| graphql               | 17.1.0  | `node_modules/graphql/package.json` (optional peer dependency of `msw/graphql`)                                                                           |
| zod                   | 4.6.7   | `node_modules/zod/package.json`                                                                                                                           |
| @octokit/rest         | 22.0.1  | `node_modules/@octokit/rest/package.json`, https://docs.github.com/en/rest/issues/comments                                                                |
| google-auth-library   | 11.3.4  | `node_modules/google-auth-library/build/src/auth/jwtclient.d.ts`, https://developers.google.com/identity/protocols/oauth2/service-account                 |
| @types/node           | 24.19.2 | `node_modules/@types/node/package.json`                                                                                                                   |
| Jira Cloud REST API   | v3      | https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json, https://developer.atlassian.com/cloud/jira/platform/rate-limiting/                |
| Atlassian GraphQL API | —       | https://developer.atlassian.com/platform/goals/goals-graphql-api/search-queries/, https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/ |
| Slack request signing | `v0`    | https://docs.slack.dev/authentication/verifying-requests-from-slack                                                                                       |
| GitHub webhooks       | —       | https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries                                                                          |
| Google Sheets API     | v4      | https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get                                                              |

## Decisions

- **Node and TypeScript, no UI and no ports.** Every exercise is a client or a handler, proven by Vitest. The Slack and GitHub handlers are tested over real HTTP on `127.0.0.1` with a port chosen by the OS (`listen(0)`), so no fixed port is reserved for this kata.
- **msw 3 fakes every external API** (`setupServer` from `msw/node`, `graphql.link(url)` from `msw/graphql`, `server.listen({ onUnhandledFrame: 'error' })`), so a request to anything not faked fails the test. Requests to the local test servers are let through explicitly with `passthrough()`. msw intercepts `fetch` (the clients, Octokit) and `node:http` requests (the `node-fetch` that `google-auth-library` uses through gaxios), so the real libraries run unchanged.
- **`graphql` is a devDependency** (approved deviation): it is the optional peer dependency `msw/graphql` needs to parse operations, and the tests use its `parse` to check that the queries are valid documents.
- **Time is injected.** Clients take `sleep`, `random` and `now`; tests record the delays and assert them exactly. No fake timers (msw 3 does not patch timers in Node, and none are needed).
- **Jira:** `POST /rest/api/3/search/jql` paginated with `nextPageToken` until `isLast`, as async generators. Pure retry policy: retry only 429 and 503, `Retry-After` (seconds) as the minimum delay plus up to 30 % jitter, otherwise 1 s doubling up to 30 s times 0.7–1.3, 5 attempts, and a `Retry-After` over 60 s fails instead of waiting. Non-retryable responses throw `JiraApiError` with Jira's messages. `mapWithConcurrency` (in `src/lib`) caps per-issue requests at 4. The base URL is concatenated, not resolved with `new URL()`, so the OAuth `/ex/jira/{cloudId}` prefix survives.
- **Atlassian GraphQL:** a generic `execute()` returns `{ data, errors }` and decides by the body, not the HTTP status; `searchGoals()` keeps partial data and returns every error with its path plus `allPagesRead`. 429 is waited until the `RETRY-AFTER` timestamp (seconds and HTTP dates are accepted too), 5xx are not retried, as Atlassian asks. Values travel as GraphQL variables; the Teams query is illustrative and marked ⚠️ in the code.
- **Slack:** the signature is verified by hand (`v0:{timestamp}:{raw body}`, 5-minute window, constant time) and tested with Slack's documented example. The handler acknowledges with an ephemeral 200 and enqueues; the worker posts Block Kit to `response_url`, which is pinned to `https://hooks.slack.com` against SSRF. Bolt is explained in the README but not installed.
- **GitHub:** `sha256=` HMAC verified by hand and tested with GitHub's documented example; `@octokit/webhooks-methods` is mentioned, not installed. Idempotency is a `DeliveryStore` port (`claim` / `release`) with an in-memory adapter; the README gives the DynamoDB conditional put and the Postgres unique key. Status codes: 401 signature, 400 malformed, 200 duplicate, 202 accepted, 413 too large. A failed processing releases the id so a redelivery can retry.
- **Background work** runs in a small in-memory runner (`src/lib/background-tasks.ts`) with `drain()` for tests; the READMEs say that production uses a durable queue (SQS with a Lambda worker).
- **Google:** `new JWT({ email, key, keyId, scopes, subject })` with the read-only Sheets scope, and `fetch` with `getRequestHeaders()`. The fake token endpoint verifies the RS256 assertion with the public half of a key pair generated at test time. Rows are read as `FORMATTED_VALUE` strings and validated without `z.coerce.number()` (an empty cell would become 0); invalid rows are returned with their sheet row number, blank rows are skipped, and a changed header throws.
- **No real credentials anywhere.** Secrets and tokens are `replace-with-…` placeholders; keys are generated at test time. The Slack and GitHub signature tests use the example values published in their documentation.
- **Flawed versions** (`*.problem.ts`) are tested in the same file as the solution. The ones whose flaw is untyped code disable `@typescript-eslint/no-explicit-any` at the top, with the reason, because the root lint config rightly rejects `any`.
- **Fixtures** in `src/data/` are fictional: issues, goals, a roster sheet and a trimmed `pull_request` payload.
- **Branch base** (deviation): the worktree branch started from `main` and was fast-forwarded to the tip of `kata/ssr-fullstack` before the first commit, as agreed on resume.

## Not verified

- ⚠️ The variable types declared in the Goals search query (`$containerId: ID!`, `$searchString: String!`, `$first: Int`, `$after: String`): Atlassian's examples pass the values inline. Check them in the GraphQL Explorer: https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/
- ⚠️ The arguments and result shape of `team { teamSearchV2 }` in `teams-query.ts` (only the field and the mandatory `siteId` are verified): https://developer.atlassian.com/platform/teams/teams-graphql-api/introduction/
- ⚠️ The HTTP status Atlassian's gateway uses for a response that carries both `data` and `errors` (the client does not depend on it): https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/
