# api-integrations

Five katas on integrating third-party APIs from Node and TypeScript, solved and explained: a Jira Cloud REST client, the Atlassian GraphQL API, a Slack slash command, GitHub webhooks and Google Sheets with a service account. Each one starts from code that works in a demo and breaks in production (missing pages, rate limits, unsigned requests, duplicate effects, pasted tokens, unvalidated data) and ends with a tested fix. Every external API is faked with msw, so everything runs offline, with no credentials and no ports to configure.

## Run

Requires Node 22.12 or later. No Docker, no accounts, no network.

```bash
cd api-integrations
npm install
npm test         # every exercise, against msw fakes of Jira, Atlassian, Slack, GitHub and Google
npm run check    # type checking
```

The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder. Each folder has the flawed version (`*.problem.ts`) next to the solution, and the tests run both.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                                      | What it practises                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Jira Cloud REST client](src/exercises/jira-rest-client/README.md)                            | Token pagination, async iterators, `Retry-After` with backoff and jitter, concurrency    |
| [Atlassian GraphQL: Goals and Teams](src/exercises/atlassian-graphql/README.md)               | Cursor pagination, partial `data` + `errors`, timestamp `RETRY-AFTER`, variables         |
| [Slack app: signed slash command](src/exercises/slack-app/README.md)                          | HMAC over the raw body, replay window, ack within 3 s, `response_url`, Block Kit         |
| [GitHub webhooks: signature and idempotency](src/exercises/github-webhooks/README.md)         | `X-Hub-Signature-256`, idempotency by `X-GitHub-Delivery`, 202 and background work       |
| [Google Sheets with a service account](src/exercises/google-sheets-service-account/README.md) | JWT bearer flow, domain-wide delegation vs sharing, least privilege, reported validation |

## Integration cheat sheet

| I need…                                  | Use                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Every result of a Jira search            | `POST /rest/api/3/search/jql`, send `nextPageToken` back until `isLast`; no `total`, no `startAt`    |
| Every page of a GraphQL connection       | `first` + `after: pageInfo.endCursor` while `pageInfo.hasNextPage`                                   |
| To survive rate limits                   | Retry only 429/503; `Retry-After` as the minimum wait; else exponential backoff with jitter; cap it  |
| Not to cause rate limits                 | A concurrency limit (`mapWithConcurrency(items, 4, fn)`), never `Promise.all` over hundreds of calls |
| To know if a GraphQL call failed         | Read `errors` in the body, whatever the status; keep `data`, report `errors` with their `path`       |
| To check a webhook comes from the sender | HMAC-SHA256 over the **raw body** with the shared secret, compared with `timingSafeEqual`            |
| To stop replays                          | A signed timestamp with a short window (Slack), or remembering delivery ids (GitHub)                 |
| To answer Slack or GitHub in time        | Acknowledge first (200/202), do the work in a queue, reply through `response_url` or the API         |
| A redelivery not to repeat the effect    | Atomic claim of the delivery id: DynamoDB `attribute_not_exists`, Postgres `ON CONFLICT DO NOTHING`  |
| Server-to-server access to Google APIs   | A service account; share the resource with it, or domain-wide delegation with `subject`              |
| To trust external data                   | Parse it with zod at the boundary; report what is invalid, never coerce it silently                  |
| Deterministic tests for retries          | Inject `sleep`, `random` and `now`; assert the recorded delays                                       |

## msw 3 cheat sheet

| I need…                                   | Use                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| A fake server in Node tests               | `setupServer()` from `msw/node`; `listen()` in `beforeAll`, `close()` in `afterAll`      |
| Tests to fail on any request nobody faked | `server.listen({ onUnhandledFrame: 'error' })` (`onUnhandledRequest` in msw 2)           |
| A REST handler                            | `http.post(url, ({ request, params }) => HttpResponse.json(body, { status, headers }))`  |
| A GraphQL handler                         | `graphql.link(endpoint).query('OperationName', ({ variables }) => HttpResponse.json(…))` |
| A handler for one test only               | `server.use(handler)` in the test, `server.resetHandlers()` in `afterEach`               |
| A response only once                      | `http.post(url, resolver, { once: true })`                                               |
| A slow response                           | `await delay(ms)` inside the resolver                                                    |
| A real request to a local server          | ``server.use(http.all(`${url}/*`, () => passthrough()))``                                |

Imports: `setupServer` from `msw/node`, `http` and `HttpResponse` from `msw/http`, `graphql` from `msw/graphql` (needs the `graphql` package), `delay` and `passthrough` from `msw`.

## Data

`src/data/` holds **fictional** data: Jira issues, goals, a team roster sheet and a trimmed GitHub `pull_request` event. Names, emails, account ids and repositories are made up. The signature tests also use the example values that Slack and GitHub publish in their documentation.
