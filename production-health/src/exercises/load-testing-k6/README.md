# Load testing with k6

## Statement

The issues service from the observability exercise is about to take a second company's traffic. Its objectives are a p95 latency under 300 ms and fewer than 1 % failed requests, at a peak of about 10 concurrent users with spikes of five times that. The only load test so far is this script, and it has never failed:

```js
export const options = { vus: 100, duration: '30s' };

export default function () {
  http.get('http://localhost:5808/healthz');
}
```

It has no thresholds, so k6 exits 0 whatever happens; it calls an endpoint that never touches the database; it fires requests back to back with no think time; and inside a container `localhost` is the container itself, so it does not even reach the service. Write a k6 test that ramps up, holds the expected peak, spikes and recovers, judges the run against the objectives, and runs with one command. Then run it once, read the output, and write the results in a report that states the weak points and the remediation plan.

## What gets assessed

- Stages that model the traffic: ramp-up, sustained load, spike and recovery, and why each one is there.
- Thresholds as the pass/fail criteria, taken from the objectives, overall and per route with tags.
- Reading the summary: percentiles over averages, `http_req_failed`, checks, throughput and iteration duration.
- Closed vs open workload models, and think time.
- Turning a run into a report: evidence, weak points, remediation and the limits of the test.

## How to approach it, step by step

1. Write down the objectives first (p95, error rate, expected peak). Thresholds come from them, not from the first run's numbers.
2. Pick realistic requests: the endpoints users call, with varied parameters (`status`, `key`), tagged with a route `name`.
3. Add checks for correctness: a status code and something about the body (a list with 20 items), because a fast wrong answer is still wrong.
4. Shape the stages from the expected traffic, and add think time so a virtual user behaves like a person.
5. Make the run one command: check that the service is ready, run the pinned k6 image, pass on k6's exit code.
6. Run it, read the thresholds first and the details after, and compare with what the service itself measured.
7. Fill in the report, including what the test did not prove.

## Solution explained

[`load-test.js`](./load-test.js) is the k6 script, [`run-load-test.ts`](./run-load-test.ts) runs it in Docker after checking the service (`npm run load-test`), and [`k6-docker.ts`](./k6-docker.ts) holds the pure parts of the runner, tested in [`k6-docker.test.ts`](./k6-docker.test.ts). [`sample-output.md`](./sample-output.md) is a real run, annotated line by line, and [`report-template.md`](./report-template.md) is the report to fill in after a run.

**Stages.** Each stage answers a question:

```js
stages: [
  { duration: '30s', target: 10 }, // ramp-up: does it warm up cleanly (connections, JIT)?
  { duration: '1m', target: 10 }, // sustained: does it meet the objectives at the expected peak?
  { duration: '10s', target: 50 }, // spike: five times the peak in ten seconds
  { duration: '30s', target: 50 }, // hold the spike: does it degrade gracefully or fall over?
  { duration: '20s', target: 10 }, // recovery: does latency come back down when the spike ends?
  { duration: '10s', target: 0 }, // ramp-down
],
```

The durations fit a laptop. Against a real environment the sustained stage lasts 10 to 30 minutes, and separate runs answer other questions: a **soak** test (hours at the sustained level) finds leaks and slowly filling queues, and a **stress** test (rising until something breaks) finds the limit and the first resource to saturate.

**Thresholds are the verdict.** They turn the objectives into code, and a failed threshold makes k6 exit with code 99, so a pipeline stops:

```js
thresholds: {
  http_req_duration: ['p(95)<300'],
  http_req_failed: ['rate<0.01'],
  'http_req_duration{name:/issues}': ['p(95)<300'],
  'http_req_duration{name:/issues/:key}': ['p(95)<300'],
  checks: ['rate>0.99'],
},
```

- **Percentiles, not averages.** An average of 50 ms is compatible with one request in twenty taking two seconds. `summaryTrendStats` adds p99 to the summary.
- **Per route.** Every request carries `tags: { name: '/issues/:key' }`, so k6 groups the 3,000 different URLs under one template (the same idea as the service's metrics), and the threshold on `{name:/issues}` can fail even when the overall p95 looks fine.
- **Checks are not failures by themselves.** A failing check only lowers the `checks` rate; the `checks: ['rate>0.99']` threshold is what makes wrong answers fail the run. `list has 20 issues` catches the 200 with an empty list that the flawed service returns when its database fails.
- **Long form for early stops.** `{ threshold: 'p(95)<300', abortOnFail: true, delayAbortEval: '30s' }` stops a run that is already lost instead of hammering a struggling environment for the remaining minutes.

**Think time and the workload model.** `sleep(0.5 + Math.random())` makes each virtual user pause like a person; without it, 10 VUs would send as many requests as the service can answer, and the test would measure k6's loop rather than 10 users. The `stages` option uses the `ramping-vus` executor, a **closed model**: each VU waits for its response before sending the next request, so when the service slows down the load drops with it, and a struggling service looks better than it is. When the question is "what happens at 100 requests per second", use an **open model**, which keeps the arrival rate whatever the latency:

```js
scenarios: {
  open_model: {
    executor: 'ramping-arrival-rate',
    startRate: 20,
    timeUnit: '1s',
    preAllocatedVUs: 50,
    maxVUs: 200,
    stages: [{ duration: '1m', target: 20 }, { duration: '10s', target: 100 }, { duration: '30s', target: 100 }],
  },
},
```

That snippet is not part of `load-test.js`; it was checked with `k6 inspect` on k6 2.4.0.

**`setup()` refuses to measure nothing.** It calls `/readyz` once and throws when the service is not ready, which aborts the run. That request is counted in the overall `http_reqs` (6,403 = 3,201 iterations × 2 + 1 in the sample).

**One command, any operating system.** `npm run load-test` first asks `/readyz` from Node and stops with "Start it first: docker compose up -d --wait, then npm start" when the service is not ready. Then it runs `docker run --rm -i --add-host=host.docker.internal:host-gateway -e BASE_URL=… grafana/k6:2.4.0 run -` and pipes the script into stdin, so no volume is mounted and no path differs between Windows, macOS and Linux. The image is pinned, because results are only comparable between runs of the same k6 version. Extra arguments go to `k6 run`: `npm run load-test -- --summary-mode=full`, or `npm run load-test -- --stage 1m:100 --stage 3m:300 --stage 30s:0` for a stress run. The exit code is k6's own (0, or 99 when a threshold failed).

**Reaching the service from the container.** Inside the k6 container `localhost` is the container. `host.docker.internal` is the host: Docker Desktop defines it, and `--add-host=host.docker.internal:host-gateway` defines it on Linux too. On Docker Desktop (the sample run, on Windows) the service listening on `127.0.0.1` was reachable that way. On Docker Engine on Linux, `host-gateway` resolves to the host's internal address rather than its loopback, so a service bound to `127.0.0.1` is not expected to answer there: start it with `HOST=0.0.0.0 npm start`, and only on a machine where that is acceptable. ⚠️ Verify: this kata was only run on Docker Desktop; Docker documents `host-gateway` at https://docs.docker.com/reference/cli/docker/container/run/ but not how it interacts with a loopback-only service.

**Reading the output.** [`sample-output.md`](./sample-output.md) goes through a real run: every threshold passed, with p95 = 7.3 ms against 300 ms and 0 failures out of 6,403 requests; the average rate (39.9 requests per second) is not the peak (about 100); and the service's own EMF metrics for the same run give a p95 of 4.3 ms on `/issues` against k6's 7.8 ms, the difference being the round trip through Docker's network. It ends with what the run does not prove, the part most reports leave out.

**The report.** [`report-template.md`](./report-template.md) separates what was tested (environment, data volume, model, version), the objectives with their results, what the service saw (CPU, event loop lag, pool usage, database), the weak points with their evidence, remediation, owner and retest criterion, and the limits of the test. A weak point without a number from the run is an opinion; a remediation without a retest criterion never gets closed.

**How it is proven.** [`k6-docker.test.ts`](./k6-docker.test.ts) checks the `docker run` arguments and the readiness check against a ready service, a service answering 503 and a closed port. The script itself is proven by running it: [`sample-output.md`](./sample-output.md) is the output of a real `npm run load-test` against the service and the Postgres container, which exited with code 0.

## Common mistakes

| Symptom                                                      | Cause                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| The load test always passes, even with the database down     | No thresholds (k6 exits 0), or only status checks on an endpoint that touches nothing.                 |
| Connection refused on every request from the k6 container    | `localhost` inside the container, or a service bound to `127.0.0.1` on Docker Engine on Linux.         |
| The summary has thousands of URLs, one per issue             | Requests without a `name` tag; every distinct URL becomes its own series.                              |
| Great results that production never matches                  | No think time and a tiny data set: the test measured a cache and a tight loop.                         |
| The service slowed down and the request rate dropped with it | A closed model (`ramping-vus`) hides overload; `ramping-arrival-rate` keeps the rate.                  |
| A good average, and users still complain                     | Judging by `avg`; the tail (p95, p99) is what users notice.                                            |
| Two runs disagree and nobody can say why                     | Different k6 versions, data volumes or environments; pin the image and record the setup in the report. |
| A "passed" report is read as "ready for any load"            | The limits of the test (one instance, short run, unknown breaking point) are not written down.         |

## Practice

Add a stress scenario with `ramping-arrival-rate` that rises until a threshold fails, run it, and fill in the report template with the first resource that saturates (the service's logs and `pg_stat_activity` show which).
