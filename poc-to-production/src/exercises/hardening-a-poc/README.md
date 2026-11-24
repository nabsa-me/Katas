# Hardening a PoC

## Statement

A proof of concept, built in an afternoon with an AI assistant, posts a daily digest to a Slack channel: the open Jira issues of a project, grouped by assignee. It worked in the demo, and now it has to run unattended every morning. This is the whole bot, in one file ([`slack-bot.problem.ts`](./slack-bot.problem.ts)):

```ts
const JIRA_TOKEN = 'replace-with-a-jira-api-token';
const headers = { Authorization: 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64'), … };
console.log('Calling Jira with', headers);

const res = await fetch(JIRA_URL + '/rest/api/3/search/jql', { method: 'POST', headers, body: … });
const data: any = await res.json();
for (const issue of data.issues) {
  const name = issue.fields.assignee.displayName;
  // …group by name and build the text…
}
const slack = await fetch('https://slack.com/api/chat.postMessage', { … });
console.log('Posted!', await slack.json());
```

Symptoms, reproduced against fakes of Jira and Slack that serve 12 open issues in pages of 5:

- The channel shows 5 of the 12 open issues: only the first page is read.
- The Jira credentials are in the logs: a Basic header is base64, not encryption.
- On a busy morning Jira answers 429, and the bot dies with `TypeError: data.issues is not iterable`. Nobody notices.
- An issue titled "Stop the deploy notice from pinging `<!channel>`" pings the whole channel.
- Someone removes the app from the channel. Slack answers `{ ok: false, error: 'not_in_channel' }` with HTTP 200, the bot prints `Posted!` and exits with 0.

Take it to production with the same functionality: configuration validated from the environment, secrets out of the code, ports and adapters, structured logs, typed errors, timeouts and retries, unit and integration tests, a short operational guide and an ADR.

## What gets assessed

- Reading a PoC with a checklist and ordering the risks (a leaked secret first, cosmetics last).
- Configuration and secrets: validated once at startup, every problem reported at once, never a value in code or logs.
- Boundaries: domain logic that tests without HTTP, and external data validated before use.
- Failure handling: timeouts, typed errors, retries only where repeating is safe, exit codes a scheduler understands.
- Operability: logs you can query, a guide to run, configure and troubleshoot it, and the decision written down.

## How to approach it, step by step

1. Run the PoC against fakes and write **characterization tests** that pin down what it does today, bugs included. They are the safety net for the refactor and the evidence for each item on your list.
2. Go through the checklist below and write down every finding, ordered by risk. A secret in the code goes first: rotate it, because it stays in git history even after you delete the line.
3. Move configuration to environment variables with a schema that fails fast and lists every problem.
4. Extract the pure part (grouping, formatting, escaping) and test it with plain data.
5. Name the two dependencies as ports (`IssueSource`, `ChatNotifier`) and write one adapter per external API: timeout, status check, response schema, typed errors.
6. Add retries, deciding per call whether repeating it is safe.
7. Write the composition root: build everything from the configuration, log structured lines, return an exit code.
8. Test the adapters and the whole bot against HTTP fakes (msw), including the failure paths.
9. Write the operational guide and a short ADR.

### Hardening checklist

Reusable for any PoC you are handed. Each unchecked item is a finding.

**Secrets and configuration**

- [ ] No secret in the code, the repository history, test fixtures or example files (placeholders only).
- [ ] Every setting comes from the environment (or a secrets store) and is validated at startup, with every problem listed at once.
- [ ] Error messages and logs name the setting, never its value.
- [ ] Any value that ends up in a query (JQL, SQL, a URL) is validated or encoded.

**External data and dependencies**

- [ ] Every response is validated before use (status code, shape), including APIs that report errors in the body over HTTP 200.
- [ ] Every outgoing call has a timeout.
- [ ] Pagination is followed to the end, with a guard against a loop that never ends.
- [ ] Text that goes into another system's markup (Slack `mrkdwn`, HTML, CSV) is escaped.

**Failure handling**

- [ ] Errors are typed and carry context (service, operation, status, cause), not just a message.
- [ ] Retries only for transient failures and only where repeating is safe; `Retry-After` honoured; backoff with jitter; a cap.
- [ ] No swallowed errors: every failure reaches a log line and the exit code.
- [ ] The process exits with a code that tells "bad configuration" from "a dependency failed" from "a bug".

**Observability**

- [ ] Structured logs (one JSON object per line), with a level, a timestamp and a correlation id per run or request.
- [ ] No `console.log` of objects that might hold credentials; redaction as a safety net.
- [ ] A success line with counts, so "it ran and did nothing" is distinguishable from "it did not run".

**Structure and tests**

- [ ] Domain logic separated from I/O, testable with plain data.
- [ ] Unit tests for the logic, integration tests for each adapter against a fake of the real API, one end-to-end test of the entry point.
- [ ] Time, randomness and the environment are injected, so tests are deterministic and fast.
- [ ] Tests cannot reach the network by accident.

**Operations**

- [ ] A README that says how to run, configure and troubleshoot it, and what happens if it runs twice.
- [ ] The main design decision written down (an ADR), with the alternatives that were rejected.
- [ ] Least privilege: the API token or bot scopes allow only what the job does.

## Solution explained

| File                                                       | Role                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`config.ts`](./config.ts)                                 | Environment variables → typed `Config`, validated with zod                      |
| [`ports.ts`](./ports.ts)                                   | `OpenIssue`, `ChatMessage` and the two ports                                    |
| [`digest.ts`](./digest.ts)                                 | Pure domain (grouping, formatting, escaping) and the use case `postDailyDigest` |
| [`jira-issue-source.ts`](./jira-issue-source.ts)           | `IssueSource` adapter: Jira search with pagination                              |
| [`slack-notifier.ts`](./slack-notifier.ts)                 | `ChatNotifier` adapter: Slack `chat.postMessage`                                |
| [`http.ts`](./http.ts)                                     | POST JSON with a timeout; status, body and schema failures become typed errors  |
| [`retry.ts`](./retry.ts)                                   | `Retry-After` parsing, backoff with jitter, `withRetry`                         |
| [`errors.ts`](./errors.ts)                                 | `ConfigError`, `UpstreamError`, `InvalidResponseError`                          |
| [`logger.ts`](./logger.ts)                                 | pino: JSON lines, level as a word, ISO time, redaction                          |
| [`main.ts`](./main.ts)                                     | Composition root and exit codes                                                 |
| [`demo.ts`](./demo.ts)                                     | Runs the bot or the PoC against the fakes                                       |
| [`adr-ports-and-adapters.md`](./adr-ports-and-adapters.md) | The architecture decision                                                       |

**Characterization tests first.** [`slack-bot.problem.test.ts`](./slack-bot.problem.test.ts) runs the PoC unchanged against the fakes of [`src/lib/fake-apis.ts`](../../lib/fake-apis.ts) (it does its work at import time, so each test re-imports it after `vi.resetModules()`). Each test pins one symptom: one Jira request and 5 of 12 issues posted; the Basic header in the output decodes to the email and token; `<!channel>` reaches Slack raw; a 429 ends in a `TypeError` after a single request; an unassigned issue crashes it; `ok: false` still prints `Posted!`.

**Configuration: parse once, fail fast.** [`config.ts`](./config.ts) validates `process.env` with a zod schema and returns a typed `Config`; nothing else in the code reads the environment.

```ts
JIRA_API_TOKEN: secret(), // required, and not the `replace-with-…` placeholder
JIRA_PROJECT_KEY: required().regex(/^[A-Z][A-Z0-9_]{1,9}$/, 'must be a Jira project key such as PLAT'),
REQUEST_TIMEOUT_MS: z.coerce.number({ error: 'must be a number of milliseconds' }).int().min(1_000).max(60_000).default(10_000),
```

`safeParse` collects every issue, so a run with an empty environment lists all six missing variables instead of failing on the first. An empty variable counts as missing (`JIRA_API_TOKEN=` would otherwise be a valid empty string), and the placeholders from `.env.example` are rejected, so copying the example without filling it fails at startup rather than with a 401 later. zod 4 does not copy the input into its issues, so the messages name the variable and the rule, never the value: a token pasted into the wrong variable does not leak through an error message. The project key regex is what makes it safe to put the key into the JQL. `describeConfig` is the loggable view: everything except the secrets.

**Secrets out of the code.** The code only reads environment variables. Locally they come from a `.env` file that git ignores, loaded by Node itself (`node --env-file-if-exists=.env`, Node 22.9+; variables already in the environment win). In AWS, the platform injects them:

- **ECS (a scheduled task):** the task definition maps each variable to AWS Secrets Manager, `"secrets": [{ "name": "JIRA_API_TOKEN", "valueFrom": "arn:aws:secretsmanager:…:secret:digest-bot-AbCdEf:jiraApiToken::" }]` (the `:jiraApiToken::` suffix selects one JSON key). The task execution role needs `secretsmanager:GetSecretValue` on that secret. Values are injected when the container starts: after a rotation, new tasks get the new value (a daily task always starts fresh).
- **Lambda:** do not put secrets in plain environment variables. The AWS Parameters and Secrets Lambda Extension serves them on `http://localhost:2773/secretsmanager/get?secretId=…` (header `X-Aws-Parameters-Secrets-Token` with the session token) and caches them for 300 s by default; Powertools for AWS Lambda has a parameters utility that does the same from code. Either way, the composition root reads the secret and passes it to `loadConfig` together with `process.env`: nothing else changes.

A secret that was ever committed is compromised: rotate it, then remove it.

**Ports and adapters.** The use case knows two interfaces from [`ports.ts`](./ports.ts):

```ts
export interface IssueSource {
  listOpenIssues(): Promise<OpenIssue[]>;
}
export interface ChatNotifier {
  post(message: ChatMessage): Promise<{ messageId: string }>;
}
```

`postDailyDigest` in [`digest.ts`](./digest.ts) reads, formats and posts through them; its tests pass two object literals, no HTTP and no mocks of `fetch`. The adapters translate: [`jira-issue-source.ts`](./jira-issue-source.ts) knows JQL, `nextPageToken` and Basic auth; [`slack-notifier.ts`](./slack-notifier.ts) knows the channel id, Bearer tokens and the `ok` field. [`main.ts`](./main.ts) is the only file that knows both sides. Why this shape and not a bigger one is in the [ADR](./adr-ports-and-adapters.md).

**External data is never trusted.** [`http.ts`](./http.ts) is the one place that talks HTTP. It sends with `AbortSignal.timeout(ms)` (a server that never answers would otherwise hang the job until the scheduler kills it), turns a non-2xx status into an `UpstreamError`, and validates the body with the adapter's zod schema. A body that is not JSON (a proxy's HTML error page) or JSON with an unexpected shape becomes an `InvalidResponseError` whose `issues` name the field (`issues.0.fields.summary: Invalid input…`). Slack needs one more step: its errors arrive as HTTP 200 with `ok: false`, so the schema is a discriminated union on `ok`, and the adapter turns `ok: false` into an `UpstreamError` with Slack's code (`not_in_channel`).

**Typed errors.** [`errors.ts`](./errors.ts) has three classes. `UpstreamError` carries `service`, `operation`, `status`, `code`, `retryable`, `retryAfterMs` and the original error in `cause`. The retry policy reads `retryable`, the composition root reads the class, and pino's error serializer prints the fields and appends the cause's message (`jira search issues failed: network: getaddrinfo ENOTFOUND …`). Nothing parses error messages.

**Retries only where repeating is safe.** Whether a failure is retryable depends on the call, so `postJson` takes `idempotent` and decides:

| Failure                           | Jira search (a read, even over POST) | Slack `chat.postMessage` (not idempotent)   |
| --------------------------------- | ------------------------------------ | ------------------------------------------- |
| 429 with `Retry-After`            | Retry                                | Retry: the request was rejected, not posted |
| 502, 503, 504                     | Retry                                | Fail: the message may have been posted      |
| Timeout or no response            | Retry                                | Fail, for the same reason                   |
| Other 4xx (401, 403, 400)         | Fail: retrying will not fix it       | Fail                                        |
| `ok: false` over HTTP 200         | —                                    | Fail: a configuration problem               |
| Response with an unexpected shape | Fail                                 | Fail                                        |

A duplicate digest is worse than a failed run that alerts. [`retry.ts`](./retry.ts) waits `base × 2^(attempt−1)`, capped, times a random factor between 0.7 and 1.3 (so clients that failed together do not retry together), and never less than `Retry-After`, which can be seconds or an HTTP date. It gives up after `maxAttempts`, or at once when `Retry-After` is longer than the cap: a daily job should fail and alert rather than wait an hour. Jira is retried page by page, so a 429 on page 3 does not restart the search. `sleep` and `random` are injected: the tests assert the exact delays (`[2000, 2000]` for two 429s with `Retry-After: 2`) without waiting and without fake timers.

**Escaping.** Slack treats `&`, `<` and `>` as control characters (`<!channel>`, `<@U123>`, `<url|text>`), so `escapeMrkdwn` replaces exactly those three with entities in every text that comes from Jira. Issue links are built from the key, which the response schema has already checked.

**Structured logging.** [`logger.ts`](./logger.ts) creates a pino logger that writes one JSON object per line: `"level":"info"` as a word, an ISO `time`, a `service` name, and, through a child logger, a `runId` shared by every line of a run. CloudWatch Logs, Datadog or Loki index those fields without parsing. The code logs safe summaries (`describeConfig`, counts, error codes) and never headers; the `redact` paths (`headers.*`, `*.apiToken`, `*.botToken`…) are the safety net if someone adds a careless line later.

**Composition root and exit codes.** [`main.ts`](./main.ts) builds the configuration, the logger, the retry options and the adapters, runs the use case and maps the outcome:

| Exit code | Meaning                                                    | Log line                                   |
| --------- | ---------------------------------------------------------- | ------------------------------------------ |
| 0         | Digest posted                                              | `daily digest posted` with the counts      |
| 2         | Invalid configuration; nothing was called                  | `invalid configuration…` with `problems`   |
| 3         | Jira or Slack failed after the retries; nothing was posted | `<service> <operation> failed…` with `err` |
| 1         | Anything else: a bug                                       | `unexpected error…` with `err`             |

It sets `process.exitCode` instead of calling `process.exit()`, so pending log lines are written first. Time, sleep, randomness and the log destination are parameters, which is what makes the end-to-end test possible.

**How it is proven.** `npm test` runs:

- Unit tests: [`config.test.ts`](./config.test.ts) (every missing variable listed, empty = missing, placeholders rejected, JQL injection rejected, no value in the message), [`retry.test.ts`](./retry.test.ts) (`Retry-After` in seconds and as a date, backoff, jitter bounds, give-up rules), [`digest.test.ts`](./digest.test.ts) (grouping, escaping, the cap per assignee, the use case with in-memory adapters), [`logger.test.ts`](./logger.test.ts) (line shape, levels, redaction, error serialization).
- Integration tests against the msw fakes: [`jira-issue-source.test.ts`](./jira-issue-source.test.ts) (three pages, auth and JQL, 429 and 503 retried, 401 not retried, invalid bodies, timeout, endless pagination) and [`slack-notifier.test.ts`](./slack-notifier.test.ts) (`ok: false` not retried, 429 retried, 503 and timeout not retried).
- End to end: [`main.test.ts`](./main.test.ts) runs `main()` with an environment and checks the exit codes, the posted text, and that no log line contains a token or the Basic header.
- Characterization of the PoC: [`slack-bot.problem.test.ts`](./slack-bot.problem.test.ts).

Every test server listens with `onUnhandledFrame: 'error'`, so a request that no fake handles fails the test instead of reaching the network. The PoC had no tests at all.

### Operational guide

**Run.**

```bash
npm run demo           # the bot against fake Jira and Slack: JSON logs, then the digest it posted
cp .env.example .env   # real mode: fill in the values (the bot refuses the placeholders)
npm run bot            # one run: reads .env, posts the digest, exits with 0, 1, 2 or 3
```

In production, schedule one run per working day (cron, an EventBridge Scheduler rule that starts an ECS task, or a Lambda) and alert on a non-zero exit code or on a missing `daily digest posted` line by mid-morning. A run is not idempotent: running it again posts a second digest. After an exit code 3 from Slack with `code: "timeout"`, check the channel before running it again.

**Configure.**

| Variable             | Required | Example                           | Notes                                                                 |
| -------------------- | -------- | --------------------------------- | --------------------------------------------------------------------- |
| `JIRA_BASE_URL`      | Yes      | `https://your-site.atlassian.net` | https only; a trailing slash is removed                               |
| `JIRA_EMAIL`         | Yes      | `digest-bot@example.com`          | The account that owns the API token                                   |
| `JIRA_API_TOKEN`     | Yes      | (secret)                          | An API token of that account, which only needs to browse the project  |
| `JIRA_PROJECT_KEY`   | Yes      | `PLAT`                            | Upper-case project key; it goes into the JQL                          |
| `SLACK_BOT_TOKEN`    | Yes      | (secret)                          | Bot token of a Slack app with the `chat:write` scope                  |
| `SLACK_CHANNEL_ID`   | Yes      | `C0123456789`                     | The channel id, not its name; the app must be a member of the channel |
| `REQUEST_TIMEOUT_MS` | No       | `10000`                           | Per request, 1000–60000                                               |
| `LOG_LEVEL`          | No       | `info`                            | `debug`, `info`, `warn` or `error`                                    |

**Troubleshoot.** Every failure ends in one log line with `level` `error` or `fatal`; filter by `runId` to see the whole run.

| Exit code and log                                                | Likely cause                                                   | What to do                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2, `problems: ["JIRA_API_TOKEN is missing", …]`                  | Variables not set, empty, or still the placeholders            | Fix every variable listed; the run called nothing                            |
| 3, `service: "jira"`, `code: "http_401"`                         | API token revoked or expired, or an email that does not own it | Create a new token for the right account and update the secret               |
| 3, `service: "jira"`, `code: "http_400"`                         | Jira rejected the JQL                                          | Check that `JIRA_PROJECT_KEY` exists and the account can browse it           |
| 3, `code: "http_429"` after `transient error, retrying`          | Rate limited for longer than the retries cover                 | Run later or at another time of day; check other jobs using the same account |
| 3, `service: "slack"`, `code: "not_in_channel"`                  | The app was removed from the channel                           | Invite the app to the channel again                                          |
| 3, `service: "slack"`, `code: "channel_not_found"`               | Wrong channel id, or a private channel the app cannot see      | Copy the id from the channel details; add the app to the channel             |
| 3, `service: "slack"`, `code: "invalid_auth"` or `token_revoked` | Bot token wrong, rotated or revoked                            | Reinstall the app or update the secret                                       |
| 3, `service: "slack"`, `code: "missing_scope"`                   | The app lacks `chat:write`                                     | Add the scope and reinstall the app                                          |
| 3, `code: "timeout"` or `"network"`                              | The service was slow or unreachable (DNS, proxy, outage)       | Check the service status; for Slack, check the channel before running again  |
| 3, `code: "invalid_response"` with `issues`                      | The API changed, or a proxy answered with an HTML page         | Read `err.issues`: they name the field that did not match                    |
| 3, `code: "too_many_pages"`                                      | Pagination did not end after 50 pages                          | Check the JQL; open issues should not need 5,000 results                     |
| 1, `unexpected error`                                            | A bug                                                          | Read `err.stack`; add a test that reproduces it                              |

## Common mistakes

| Symptom                                                             | Cause                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The token was removed from the code but still works for an attacker | It is in git history. Rotate it; deleting the line is not enough.                                        |
| The configuration error appears one variable per run                | Validation that throws on the first problem. Collect every issue (`safeParse`) and report them together. |
| Credentials appear in the logs                                      | Logging headers or whole request or config objects. Log safe summaries; keep redaction as a safety net.  |
| The job "succeeds" and posts nothing                                | Not checking `ok` in Slack's HTTP 200 answers, or swallowing errors and exiting with 0.                  |
| Two digests in the channel                                          | Retrying a non-idempotent call after a timeout or a 5xx, when the first attempt had been processed.      |
| The job hangs until the scheduler kills it                          | `fetch` without a timeout.                                                                               |
| Only part of the data, and no error                                 | Ignoring `nextPageToken` (or `isLast`), so only the first page is read.                                  |
| Retries make an outage worse                                        | Retrying immediately, without backoff or jitter, or ignoring `Retry-After`.                              |
| Tests are slow or flaky                                             | Real sleeps and real time. Inject `sleep`, `now` and `random`.                                           |
| Unit tests need HTTP mocks for every case                           | Domain logic mixed with I/O. Put it behind ports and test it with plain objects.                         |

## Practice

Make a rerun safe: record each posted digest by date (for example a DynamoDB conditional put on `digest#2026-11-24`, or a file in development) behind a new port, skip posting if it already exists, and add the test that runs `main()` twice and expects one message.
