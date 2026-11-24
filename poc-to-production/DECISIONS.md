# Decisions

## Versions

Checked on 2026-11-24.

| Package / tool              | Version | Verified against                                                                                                                               |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| zod                         | 4.6.7   | npm registry; `z.url({ protocol, hostname })`, `z.email()`, error functions and `issue.input` checked against the installed package            |
| pino                        | 10.4.0  | npm registry; `pino.d.ts` (`stdTimeFunctions.isoTime`, `formatters.level`, `redact`) and `pino-std-serializers` 7.1.0 (`err` and `cause`)      |
| msw                         | 3.0.7   | npm registry (`engines.node >=22.12.0`); `setupServer` from `msw/node`, `http`/`HttpResponse` from `msw/http`, `onUnhandledFrame`              |
| vitest                      | 5.1.1   | npm registry                                                                                                                                   |
| tsx                         | 4.23.15 | npm registry                                                                                                                                   |
| typescript                  | 6.0.3   | npm registry (same minor as the root tooling)                                                                                                  |
| @types/node                 | 24.19.2 | npm registry                                                                                                                                   |
| Node `--env-file-if-exists` | 22.9.0+ | https://nodejs.org/api/cli.html (stable since 22.21.0 and 24.10.0)                                                                             |
| Jira enhanced search        | REST v3 | https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/ (`POST /rest/api/3/search/jql`, `nextPageToken`, `isLast`) |
| Slack `chat.postMessage`    | Web API | https://docs.slack.dev/reference/methods/chat.postMessage, https://docs.slack.dev/apis/web-api/rate-limits                                     |
| Slack text escaping         | —       | https://docs.slack.dev/messaging/formatting-message-text                                                                                       |
| Secrets Manager on ECS      | —       | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html                                                |
| Secrets Manager on Lambda   | —       | https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html                                                                         |

## Decisions

- **The bot is a Node CLI job with no framework.** It runs once and exits, like a scheduled task. Built-in `fetch` plus two runtime dependencies (zod and pino) keep every mechanism visible: no HTTP client, no SDKs, no framework.
- **Jira and Slack faked with msw, in `src/lib/fake-apis.ts`, with its own test in the scaffold commit.** The fakes are shared by the tests and the demo, so they live in `src/lib`, and their test gives the scaffold commit something to type-check and run. They reproduce what matters for hardening: `nextPageToken` pagination with a fixed page size of 5 (12 issues span three pages), credential checks, 429 with `Retry-After`, 5xx, and Slack errors as HTTP 200 with `ok: false`.
- **An extra `http.ts` helper**, not in the original file list: the one place with the timeout, the status check, JSON parsing and schema validation, so both adapters stay short and map failures the same way. It takes `idempotent`, which decides what may be retried.
- **Retries depend on idempotency, not on the HTTP method.** The Jira search is a read sent as POST and is retried on 429, 502–504, timeouts and network errors. Slack's `chat.postMessage` is retried only on 429, where Slack rejected the request; a timeout or a 5xx may hide a posted message, and a duplicate digest is worse than a failed run.
- **Time and randomness are injected** (`sleep`, `random`, `now`), so tests assert exact delays without waiting and without fake timers. Jitter is ×0.7–1.3, as Atlassian's rate limiting guide recommends, with `Retry-After` as the minimum wait. A `Retry-After` longer than the cap (30 s) fails the run instead of waiting.
- **Exit codes 0, 1, 2, 3** (ok, unexpected, configuration, upstream) through `process.exitCode`, so pino's pending lines are flushed before exit.
- **Entry point guard with `import.meta.url === pathToFileURL(process.argv[1]).href`.** `import.meta.main` would be simpler, but it was added in Node 22.18.0 and 24.2.0 and is still experimental, while the kata supports Node 22.12.
- **Scripts `bot`, `demo` and `demo:problem`.** `bot` is the optional real mode (`node --env-file-if-exists=.env --import tsx …`); the demos run either version against the fakes in the same process, so the comparison needs no credentials.
- **Placeholders, not fake tokens, in the PoC and in `.env.example`** (`replace-with-a-jira-api-token`). The configuration rejects any secret that starts with `replace-with-`, so a copied example fails at startup. The fakes accept `fake-…` values, which look nothing like real token formats.
- **The PoC runs at import time** (top-level `await`), as such scripts usually do. Its characterization tests re-import it after `vi.resetModules()` and capture `console.log`. It disables `@typescript-eslint/no-explicit-any` on the two lines that show its untyped code, with a reason, so the root lint passes.
- **pino with `formatters.level` and `stdTimeFunctions.isoTime`**: `"level":"info"` and ISO timestamps are easier to grep and to query than numbers. Redaction paths are case-sensitive, so headers are redacted with `headers.*`. The code never logs headers or secrets in the first place; redaction is the safety net.
- **zod error functions** report `is missing` when `issue.input` is `undefined`, and empty variables are removed before parsing so they count as missing. zod 4 does not include the input in its issues by default, which keeps values out of the error messages (tested).
- **The exercise README keeps the template's sections and order.** The hardening checklist is a subsection of "How to approach it, step by step" and the operational guide (run, configure, troubleshoot) a subsection of "Solution explained".
- **The ADR is named `adr-ports-and-adapters.md`** and lives in the exercise folder, next to the code it describes.
- **No ports or services:** nothing listens on a port and nothing needs Docker.

## Not verified

None.
