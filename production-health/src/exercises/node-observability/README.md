# Observability for a Node service

## Statement

The issues service answers `GET /issues?status=todo&limit=20` and `GET /issues/:key` from Postgres. Its handler, reduced to what matters:

```ts
console.log('Incoming request ' + req.method + ' ' + req.url);
try {
  body = { issues: await issues.list({ status, limit }) };
} catch {
  // nothing
}
res.end(JSON.stringify(body));
```

Symptoms during the last database failover: for twenty minutes users saw empty boards, the dashboards showed nothing but 200s, the logs held thousands of `Incoming request` lines that nobody could tie to a failing request, and the load balancer kept sending traffic to instances whose connections were broken, because the service has no health endpoints.

Make the service observable: structured logs with a correlation id on every line of a request, a liveness endpoint and a readiness endpoint that checks the database, errors that are logged with their stack and reported to Sentry (enabled only when a DSN is configured), one CloudWatch Embedded Metric Format (EMF) line per request, and CDK alarms on p95 latency and error rate.

## What gets assessed

- Structured logs with pino, and a correlation id propagated with `AsyncLocalStorage` instead of being passed by hand.
- Liveness vs readiness: what each one checks, and why liveness checks no dependency at all.
- One error boundary: nothing swallowed; every failure logged with its stack, reported once, and answered with a 500 that carries the id.
- Metrics: EMF structure, dimensions vs properties, route templates instead of paths, and alarms on p95 and on an error rate.
- Proving it with tests: overlapping requests, a database that refuses connections, a database that accepts them and never answers.

## How to approach it, step by step

1. Reproduce the blindness: run the flawed handler ([`app.problem.ts`](./app.problem.ts)) against a repository that throws. It answers 200 with an empty list and writes nothing useful.
2. Replace `console.log` with pino: one JSON object per line, the level as a word, ISO timestamps, the service name on every line.
3. Add the correlation id: read `x-correlation-id`, keep it only if it is short and made of safe characters, otherwise create a UUID; run the whole request inside `AsyncLocalStorage.run()`; add the id to every line with pino's `mixin()`; echo it in the response header.
4. Put one `try/catch` around the request: log the error with `err`, report it, answer 500 with the id. Remove every other `catch` that only hides errors.
5. Add `/healthz` (no dependencies) and `/readyz` (`SELECT 1` with a timeout, through its own connection). Make readiness fail while the process drains on `SIGTERM`.
6. Emit one EMF line per request with the route template as a dimension, and write a validator for the structure.
7. Define the alarms in CDK on exactly those metrics and test the synthesized template.
8. Add Sentry last: `instrument.ts` loaded with `node --import`, initialised only when `SENTRY_DSN` is set.

## Solution explained

The request lifecycle is in [`app.ts`](./app.ts); the correlation id in [`context.ts`](./context.ts) and [`logger.ts`](./logger.ts); health checks in [`health.ts`](./health.ts); the Postgres adapters in [`postgres-issues.ts`](./postgres-issues.ts) (on the pool from [`src/lib/postgres.ts`](../../lib/postgres.ts)); metrics in [`emf.ts`](./emf.ts) and [`routes.ts`](./routes.ts); alarms in [`alarms-stack.ts`](./alarms-stack.ts); Sentry in [`sentry.ts`](./sentry.ts) and [`instrument.ts`](./instrument.ts); configuration in [`config.ts`](./config.ts); and the wiring, startup and graceful shutdown in [`main.ts`](./main.ts). [`app.problem.ts`](./app.problem.ts) is the flawed version.

**The correlation id, without passing it around.** A request gets its id once, and everything it does runs inside `AsyncLocalStorage`:

```ts
const correlationId = correlationIdFrom(req.headers['x-correlation-id']);
runWithContext({ correlationId }, () => handle(deps, req, res, correlationId));

// logger.ts: runs for every line, wherever it is written
mixin: () => {
  const context = currentContext();
  return context ? { correlationId: context.correlationId } : {};
},
```

`AsyncLocalStorage` follows the asynchronous work started inside `run()`: awaits, timers, promise callbacks and the database driver's socket callbacks. The repository logs its queries without knowing that requests exist, and its lines still carry the right id. The alternative, a child logger per request passed through every function, works too, but every signature has to carry it and one forgotten parameter loses the id. The test that matters runs two requests at once, holds the first one inside the repository, lets the second finish first, and checks the six log lines in the order they were written: each one carries the id of its own request.

**Reusing the caller's id, safely.** When the caller (a gateway, another service) sends `x-correlation-id`, reusing it lets one search find the request in every service it went through. The value goes into every log line and a response header, so only letters, digits and `._:-`, up to 128 characters, are accepted; anything else gets a new UUID. A newline could forge log lines in a text log, a control character would make Node reject the header and fail the request, and a long value would bloat every line. For tracing across services with spans and timings, the standard is W3C `traceparent` (OpenTelemetry, Sentry); the correlation id is its log-only counterpart.

**Contexts follow resources, not requests.** A socket's callbacks run in the context where the socket was created. When an idle pool connection drops, its `error` event fires in the context of the request that happened to open that connection, minutes earlier, and the log line would blame that request. A test proves it with a real Postgres connection terminated by `pg_terminate_backend`; `logIdleConnectionError()` logs through `runOutsideContext()` (`AsyncLocalStorage.exit()`), and a second test checks the line has no correlation id.

**One error boundary.** Only `handle()` catches, and the catch does three things: logs `{ err }` (pino's serializer keeps the type, message, stack and `cause`), calls `reportError` once, and answers `{ error: 'internal_error', correlationId }`. The user can quote the id to support, and the id finds both the log line and the Sentry event. Expected outcomes are not errors: an invalid query is a 400 and a missing issue a 404, logged at `info`. One more trap: `node:http` ignores the promise an `async` listener returns, so a rejection there is unhandled and Node ends the process; `createApp()` attaches a `.catch()` as the last line of defence.

**Liveness vs readiness.** They answer different questions, and the orchestrator acts differently on each:

- `/healthz` answers "should this process be restarted?" It checks nothing but that the event loop answers. If it checked the database, a database outage would make every instance restart in a loop, adding a stampede of new connections to the outage.
- `/readyz` answers "should this instance receive traffic now?" It runs `SELECT 1` and fails with 503 when the database does not answer; the load balancer takes the instance out of rotation and puts it back when the check passes, with no restart.
- **A timeout on every check.** A database that accepts the TCP connection and never answers is worse than one that refuses it: without a timeout the probe hangs until the orchestrator's own timeout, which reports nothing useful. The probe's pool has a 1-second connection timeout, and `createHealth()` races every check against its own timer as a safety net. Tests cover both: a closed port fails at once (`ECONNREFUSED`), and a TCP server that never answers fails within the pool's timeout.
- **Its own connection.** The probe uses a separate pool with one connection. Under peak load the application pool is busy by design; a probe queueing behind it would fail, take a healthy instance out of rotation and push its traffic onto the others, which then fail the same way.
- **Names, not reasons.** The response says which check failed and how long it took; the reason (`connect ECONNREFUSED 10.0.4.7:5432`, `password authentication failed for user …`) goes only to the `warn` log line. A test checks that the address never reaches the response.
- **Draining.** On `SIGTERM`, `main.ts` makes readiness fail, keeps serving for `DRAIN_DELAY_MS` so the load balancer notices, then stops accepting connections, finishes the requests in flight, closes both pools and flushes Sentry. Without the delay, requests that the load balancer is still routing to the instance would hit a closed port.
- **Only hard dependencies.** Readiness checks what this instance cannot serve without. Business conditions (data that has not been refreshed for a day) belong in an alarm, not in readiness: failing readiness for them takes every instance out of rotation at once and turns stale data into an outage.

**Metrics with EMF.** Each request writes one line like this one (from a real run, pretty-printed here):

```json
{
  "_aws": {
    "Timestamp": 1795530338591,
    "CloudWatchMetrics": [
      {
        "Namespace": "Katas/ProductionHealth",
        "Dimensions": [["Service", "Route"]],
        "Metrics": [
          { "Name": "Latency", "Unit": "Milliseconds" },
          { "Name": "Requests", "Unit": "Count" },
          { "Name": "Errors", "Unit": "Count" }
        ]
      }
    ]
  },
  "Service": "issues-service",
  "Route": "/issues/:key",
  "Latency": 4.73,
  "Requests": 1,
  "Errors": 0,
  "StatusCode": 200,
  "Method": "GET",
  "correlationId": "f0023d9a-…"
}
```

CloudWatch Logs reads the `_aws` metadata and turns the named top-level values into metrics; the rest of the line stays a log event, searchable in Logs Insights. Lambda extracts EMF from stdout automatically; elsewhere the CloudWatch agent collects the lines (for containers on ECS and EKS, AWS now recommends sending custom metrics to the CloudWatch OTLP endpoint instead). The design decisions:

- **Dimensions are a cost multiplier.** Every distinct combination of dimension values is a separate metric, billed separately. `Service` and `Route` give a handful; the correlation id as a dimension would create one metric per request, so it is a property. For the same reason the route is the template (`/issues/:key`), never the path (`/issues/PLAT-1`, `/issues/PLAT-2`…), and every unknown path counts as `unmatched`, whatever a scanner tries. A test sends `/issues/PLAT-7`, `/issues/PLAT-8` and `/wp-admin/install.php` and gets two `/issues/:key` events and one `unmatched`.
- **Errors are 5xx only, and always present.** A 404 or a 400 is the client's mistake and must not page anybody. `Errors` is written as 0 on success rather than left out, so "no errors" is distinguishable from "no data".
- **Not through the logger.** The EMF writer prints straight to stdout: a metric must not vanish because someone raised `LOG_LEVEL` to `warn`.
- **Validated.** `emfProblems()` checks what CloudWatch would reject: every metric needs a numeric value at the top level, every dimension a string, at most 100 metrics and 30 dimensions per set, and a timestamp in epoch milliseconds. An app test runs it on the events of real requests.

**Alarms in CDK.** [`alarms-stack.ts`](./alarms-stack.ts) creates, per user route, a p95 latency alarm (`statistic: 'p95'`, above 300 ms) and an error-rate alarm (`MathExpression` `100 * errors / requests` over the `Sum` of both, above 1 %), both firing on 3 breaching minutes out of 5 and notifying an SNS topic on alarm and on recovery:

- **p95, not the average.** An average of 80 ms can hide 5 % of requests taking 2 seconds, and those are the users who complain.
- **A rate, not a count.** Ten errors a minute are an incident at 100 requests a minute and noise at 100,000.
- **Per route, because of the dimension set.** A CloudWatch metric is identified by its namespace, name and complete set of dimensions. The service emits `Service` + `Route`, so an alarm on `Service` alone would watch a metric that does not exist and never fire: it shows `INSUFFICIENT_DATA`, or `OK` when missing data is treated as not breaching. A test reads the dimension set from `requestMetricsEvent()` and checks that every alarm uses exactly that set.
- **Missing data is not breaching**, because a quiet night produces no data points. The flip side: a service that stops completely produces no data either, and these alarms stay green. That needs its own alarm, such as `Requests` below a minimum with missing data treated as breaching, or a synthetic check from outside.
- **Proven without deploying.** `Template.fromStack()` synthesizes the stack in the test and `hasResourceProperties('AWS::CloudWatch::Alarm', …)` asserts the alarms, the expression, the periods and the actions. `cdk deploy` is never run.

**Sentry.** [`instrument.ts`](./instrument.ts) is loaded with `node --import` before `main.ts` (see `npm start`). Sentry 11 instruments ES modules through loader hooks that must be registered before `http` and `pg` are imported, and it no longer supports `--require`. `Sentry.init()` runs only when `SENTRY_DSN` is set, so locally and in the tests nothing is initialised and `captureException` does nothing (tested). `dataCollection`, which replaced `sendDefaultPii` in Sentry 11, is set explicitly and conservatively: no user data, cookies, bodies, database values or local variables, and only an allow-list of headers and query parameters. Every reported error carries the `correlationId` tag. Checked by hand with a DSN pointing to a local envelope sink: a request that failed because Postgres was stopped arrived as an event with the message `connect ECONNREFUSED 127.0.0.1:5809`, the tag and the transaction `GET /issues`.

**Configuration** is validated once at startup with zod ([`config.ts`](./config.ts)); every variable has a local default, the service listens on `127.0.0.1` unless `HOST` says otherwise, and error messages name variables, never values (`DATABASE_URL` carries a password).

**How it is proven.** [`app.test.ts`](./app.test.ts) runs both versions over real HTTP with stubs: the flawed one answers 200 and an empty list on a database failure, has no health endpoints and writes lines nobody can attribute; the solution keeps the id on every line with requests interleaved, answers `/readyz` 503 without leaking the reason, turns a failure into a 500 with a logged stack and one report, emits valid EMF events named by route template, and validates input before the repository sees it. [`postgres-issues.test.ts`](./postgres-issues.test.ts) runs against the Postgres from `docker-compose.yml`: queries, the probe against a live database, a closed port and a silent server, and idle connection errors with and without a request context. [`health.test.ts`](./health.test.ts), [`context.test.ts`](./context.test.ts), [`emf.test.ts`](./emf.test.ts), [`routes.test.ts`](./routes.test.ts), [`config.test.ts`](./config.test.ts), [`sentry.test.ts`](./sentry.test.ts) and [`alarms-stack.test.ts`](./alarms-stack.test.ts) cover the parts. `main.ts` is wiring and is exercised by running it: `npm start`, and the load test in the next exercise.

## Common mistakes

| Symptom                                                       | Cause                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Users see empty lists during an outage, dashboards show 200s  | A `catch {}` (or `catch { return [] }`) turns a failure into a normal answer.                           |
| The correlation id is missing on some lines                   | A child logger passed by hand and forgotten somewhere, or work started outside `AsyncLocalStorage.run`. |
| An error log line carries the id of an unrelated request      | An event from a pooled resource (socket, connection) runs in the context of whoever created it.         |
| Every instance restarts in a loop during a database outage    | The database is checked in the liveness probe.                                                          |
| Instances leave the load balancer one after another at peak   | The readiness probe queues behind the saturated application pool.                                       |
| `/readyz` hangs, and the orchestrator reports only "timeout"  | No timeout on the check, and a database that accepts connections without answering.                     |
| The CloudWatch bill jumps after adding metrics                | A high-cardinality dimension: the raw path, a user id or a correlation id.                              |
| An alarm never fires, even during an incident                 | Its dimensions differ from the set the service emits, so it watches a metric that does not exist.       |
| Metrics disappear when the log level is raised                | EMF lines written through the logger at `info`.                                                         |
| Sentry captures errors but no `http` or `pg` spans            | `Sentry.init()` ran after the modules were imported, instead of in a file loaded with `--import`.       |
| The process dies on a dropped idle connection                 | No `error` listener on the `pg.Pool`.                                                                   |
| Requests fail with connection refused during every deployment | The server closes at once on `SIGTERM`, before the load balancer has stopped routing to it.             |

## Practice

Propagate the correlation id to outgoing calls: add a small `fetch` wrapper that sends `x-correlation-id` from the current context, start a second service that the issues service calls, and write a test that finds the same id in the log lines of both.
