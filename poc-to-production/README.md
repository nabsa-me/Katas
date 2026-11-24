# poc-to-production

A kata on taking a proof of concept to production, solved and explained: a single-file bot that posts a daily digest of open Jira issues to Slack, next to the same bot hardened with validated configuration, secrets out of the code, ports and adapters, typed errors, timeouts, safe retries, structured logs, tests, an operational guide and an ADR. Jira and Slack are faked with msw, so everything runs without credentials or network.

## Run

Requires Node 22.12 or later.

```bash
cd poc-to-production
npm install
npm test               # unit, integration and end-to-end tests against fake Jira and Slack (Vitest, msw)
npm run check          # type checking
npm run demo           # the hardened bot against the fakes: JSON log lines, then the digest it posted
npm run demo:problem   # the PoC against the same fakes: the leaked header and a partial digest
npm run bot            # optional real mode: copy .env.example to .env and fill it in first
```

The statement, the hardening checklist, the explained solution, the operational guide and the common mistakes are in the exercise's `README.md`.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                   | What it practises                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Hardening a PoC](src/exercises/hardening-a-poc/README.md) | Config validation, secrets, ports and adapters, typed errors, timeouts, retries, pino, msw tests, ADR |

## Hardening cheat sheet

| I need…                                       | Use                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Configuration from the environment, validated | A zod schema parsed once at startup with `safeParse`, reporting every issue at once                         |
| A secret on my machine                        | `.env` (ignored by git) and `node --env-file-if-exists=.env`; commit only `.env.example`                    |
| A secret in an ECS task                       | Task definition `secrets: [{ name, valueFrom: <Secrets Manager ARN> }]`, injected at start                  |
| A secret in a Lambda function                 | AWS Parameters and Secrets Lambda Extension, or the Powertools parameters utility                           |
| A timeout on `fetch`                          | `signal: AbortSignal.timeout(ms)`                                                                           |
| A response I can trust                        | Check the status, then validate the body with a schema; Slack: check `ok`, not the HTTP status              |
| An error with context                         | A subclass with typed fields and `cause`: `super(message, { cause })`                                       |
| To retry                                      | Only 429s and transient failures of idempotent calls; `Retry-After` as the minimum; jittered backoff; a cap |
| Logs a machine can query                      | pino: one JSON object per line, a child logger with a run or request id, `redact` for secrets               |
| Domain logic that tests without HTTP          | Ports (interfaces) for each dependency, one adapter per API, wiring in a composition root                   |
| Tests that never reach the network            | msw `setupServer(...)` with `server.listen({ onUnhandledFrame: 'error' })`                                  |
| Tests for code that waits or uses randomness  | Inject `sleep`, `now` and `random`; assert the delays instead of waiting                                    |
| Text from users or APIs in a Slack message    | Escape `&`, `<` and `>` as `&amp;`, `&lt;` and `&gt;`                                                       |
| A job a scheduler can monitor                 | Distinct exit codes, set with `process.exitCode`, and a success log line with counts                        |

## Data

`src/data/jira-open-issues.json` holds 12 **fictional** open issues in the shape of a Jira search response (keys, summaries and assignees are made up). Two summaries contain Slack control characters on purpose, and one issue is unassigned.
