# production-health

Three katas on running a Node service in production, solved and explained: making it observable (structured logs with a correlation id, liveness and readiness, Sentry, CloudWatch metrics and CDK alarms), load testing it with k6 against its objectives, and handling an incident from the first signal to the postmortem and the runbook. The first two work on the same small issues service, a `node:http` server backed by Postgres; the third is a document exercise about the pipeline that feeds its data.

## Run

Requires Node 22.12 or later and Docker (Postgres and k6 run in containers).

```bash
cd production-health
npm install
docker compose up -d --wait   # Postgres 16 on port 5809 with 3,000 fictional issues
npm test                      # every exercise; the database tests need the Postgres above
npm run check                 # type checking
npm start                     # the issues service on http://127.0.0.1:5808 (Ctrl+C stops it)
npm run load-test             # k6 2.4.0 in Docker against the running service (about 3 minutes)
docker compose down           # stop Postgres (add -v to reset its data)
```

`npm start` needs no configuration. To change the port, the log level or the drain delay, or to send errors to Sentry, copy `.env.example` to `.env` (never committed) and edit it. The service answers `GET /healthz`, `GET /readyz`, `GET /issues?status=todo&limit=20` and `GET /issues/PLAT-42`, and writes one JSON log line and one EMF metrics line per request on stdout.

The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                       | What it practises                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [Observability for a Node service](src/exercises/node-observability/README.md) | pino, `AsyncLocalStorage`, liveness vs readiness, error boundary, Sentry, EMF, CDK alarms       |
| [Load testing with k6](src/exercises/load-testing-k6/README.md)                | Stages, thresholds per route, reading the summary, closed vs open models, a load test report    |
| [Incident simulation](src/exercises/incident-simulation/README.md)             | Severity and roles, messages to management, blameless postmortem, runbook, freshness monitoring |

## Production health cheat sheet

| I need…                                           | Use                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| To follow one request through every log line      | A correlation id in `AsyncLocalStorage`, added by pino's `mixin()`; echo it in `x-correlation-id` |
| Logs a machine can query                          | One JSON object per line (pino), level as a word, ISO time, the service name on every line        |
| To know whether to restart the process            | `/healthz`: the event loop answers; no dependencies                                               |
| To know whether to send it traffic                | `/readyz`: hard dependencies only, each with a timeout, through its own connection                |
| Not to lose a failure                             | One `try/catch` at the request boundary: log `{ err }`, report once, 500 with the correlation id  |
| Not to crash on an `async` request listener       | `.catch()` on the promise: `node:http` ignores it, and an unhandled rejection ends the process    |
| Not to crash when the database drops a connection | An `error` listener on the `pg.Pool`, logged outside any request context                          |
| Sentry with ES modules                            | `node --import ./instrument.ts`; `Sentry.init` only with a DSN; explicit `dataCollection`         |
| Metrics from logs                                 | CloudWatch EMF: `_aws` metadata plus top-level values; Lambda extracts it from stdout             |
| Metrics that don't explode the bill               | Few dimensions (`Service`, `Route` template); ids and status codes as properties                  |
| An alarm that matters to users                    | p95 latency and error rate (`100 * errors / requests`), 3 of 5 minutes, per dimension set emitted |
| To notice that something stopped                  | A heartbeat or freshness alarm that treats missing data as breaching                              |
| Deploys without failed requests                   | On `SIGTERM`: fail readiness, wait for the load balancer, `server.close()`, close pools           |
| A load test that can fail                         | k6 thresholds from the objectives (`p(95)<300`, `rate<0.01`), per route with `name` tags          |
| Load that does not drop when the service slows    | The `ramping-arrival-rate` executor (open model) instead of `stages` (closed model)               |
| To tell management about an incident              | Within 15 minutes: impact, what is not affected, what is being done, next update time             |
| A postmortem that changes something               | Blameless ("why did the system allow it"); actions typed prevent / detect / mitigate, with owners |

## Data

`src/data/issues.sql` creates the `issues` table and 3,000 **fictional** issues (`PLAT-1` to `PLAT-3000`), generated deterministically so every fresh container holds the same rows. Titles and assignee names are made up. The incident scenario (its system, dates, numbers and messages) is fictional too.
