# Sample output, annotated

A real run of `npm run load-test` on 2026-11-24, unedited except where `…` marks removed progress lines (k6 prints two every second). The setup: the issues service from the observability exercise running with `npm start` (one Node process, `LOG_LEVEL=info`), the Postgres 16 container from `docker-compose.yml` with its 3,000 fictional issues, and k6 2.4.0 in Docker Desktop on the same Windows laptop.

```text
> production-health@0.1.0 load-test
> tsx src/exercises/load-testing-k6/run-load-test.ts

         /\      Grafana   /‾‾/
    /\  /  \     |\  __   /  /
   /  \/    \    | |/ /  /   ‾‾\
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/


     execution: local
        script: -
        output: -

     scenarios: (100.00%) 1 scenario, 50 max VUs, 3m10s max duration (incl. graceful stop):
              * default: Up to 50 looping VUs for 2m40s over 6 stages (gracefulRampDown: 30s, gracefulStop: 30s)


running (0m01.0s), 01/50 VUs, 0 complete and 0 interrupted iterations
default   [   1% ] 01/50 VUs  0m01.0s/2m40.0s
…
running (1m39.0s), 45/50 VUs, 956 complete and 0 interrupted iterations
default   [  62% ] 45/50 VUs  1m39.0s/2m40.0s

running (1m40.0s), 49/50 VUs, 1005 complete and 0 interrupted iterations
default   [  62% ] 49/50 VUs  1m40.0s/2m40.0s
…

  █ THRESHOLDS

    checks
    ✓ 'rate>0.99' rate=100.00%

    http_req_duration
    ✓ 'p(95)<300' p(95)=7.3ms

      {name:/issues}
      ✓ 'p(95)<300' p(95)=7.8ms

      {name:/issues/:key}
      ✓ 'p(95)<300' p(95)=6.48ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS

    checks_total.......: 9603    59.834409/s
    checks_succeeded...: 100.00% 9603 out of 9603
    checks_failed......: 0.00%   0 out of 9603

    ✓ list answers 200
    ✓ list has 20 issues
    ✓ issue answers 200

    HTTP
    http_req_duration..............: avg=5.08ms min=2.88ms   med=4.76ms p(90)=6.3ms  p(95)=7.3ms  p(99)=11.86ms max=42.55ms
      { expected_response:true }...: avg=5.08ms min=2.88ms   med=4.76ms p(90)=6.3ms  p(95)=7.3ms  p(99)=11.86ms max=42.55ms
      { name:/issues }.............: avg=5.63ms min=3.37ms   med=5.27ms p(90)=6.75ms p(95)=7.8ms  p(99)=12.53ms max=42.55ms
      { name:/issues/:key }........: avg=4.52ms min=2.88ms   med=4.21ms p(90)=5.4ms  p(95)=6.48ms p(99)=10.92ms max=41.02ms
    http_req_failed................: 0.00%  0 out of 6403
    http_reqs......................: 6403   39.895836/s

    EXECUTION
    iteration_duration.............: avg=1.01s  min=510.56ms med=1s     p(90)=1.4s   p(95)=1.46s  p(99)=1.49s   max=1.52s
    iterations.....................: 3201   19.944803/s
    vus............................: 1      min=1         max=50
    vus_max........................: 50     min=50        max=50

    NETWORK
    data_received..................: 12 MB  73 kB/s
    data_sent......................: 663 kB 4.1 kB/s




running (2m40.5s), 00/50 VUs, 3201 complete and 0 interrupted iterations
default ✓ [ 100% ] 00/50 VUs  2m40s
```

The command exited with code 0: every threshold passed.

## How to read it, top to bottom

**The header.** `script: -` means the script came from stdin (the runner pipes `load-test.js` into `k6 run -`, so nothing is mounted into the container). `output: -` means the metrics went nowhere but this summary; `--out` would stream them to a file, Prometheus or Grafana Cloud. The scenario line is k6 translating `stages` into the `ramping-vus` executor: up to 50 virtual users (VUs) over 6 stages in 2m40s, plus 30 s of graceful stop for iterations still running at the end, hence `3m10s max duration`.

**The progress lines.** One pair per second: elapsed time, active VUs, and iterations completed or interrupted. The excerpt is the spike: from 45 to 49 VUs in a second, and the completed count jumping by 49 in that second, against about 10 per second during the sustained stage. `interrupted iterations` stays at 0: no iteration was cut off by the ramp-down or the end of the test.

**`THRESHOLDS` first, because they are the verdict.** Each line is a criterion from `options.thresholds` and the value it was judged on. All five pass, with an enormous margin: p95 of 7.3 ms against a budget of 300 ms, and not one failed request. The per-route lines (`{name:/issues}`, `{name:/issues/:key}`) exist because the requests carry a `name` tag; without the tag, the list endpoint's p95 could be hidden by the faster single-issue endpoint.

**`checks`.** 9,603 checks are 3,201 iterations × 3 checks. A check failing does not fail the test by itself, which is why `checks: ['rate>0.99']` is a threshold. `list has 20 issues` is the important one: a 200 with an empty list would pass a status check and still be wrong, which is exactly what the flawed service of the previous exercise does when its database fails.

**`HTTP`.**

- `http_req_duration` is the time from sending the request to receiving the whole response, without DNS and connection setup. Read the percentiles, not `avg`: p95 = 7.3 ms means 95 % of requests took 7.3 ms or less; p99 = 11.86 ms and `max` = 42.55 ms describe the tail.
- `{ expected_response:true }` is the same metric for successful responses only. With errors it usually differs (fast 500s pull the overall numbers down); here it is identical because nothing failed.
- `http_req_failed` counts responses outside 200–399 and network errors: 0 out of 6,403.
- `http_reqs`: 6,403 requests are 3,201 iterations × 2, plus the one `/readyz` request of `setup()`. That request has no `name` tag, so it appears in the overall line and in no per-route line.
- 39.9 requests per second is the **average over the whole run**, ramp-up and ramp-down included. The peak, while 50 VUs were active, was about 100 requests per second (the service's own logs counted roughly 1,000 per 10 seconds).

**`EXECUTION`.** `iteration_duration` averages 1.01 s: two requests of a few milliseconds plus the 0.5–1.5 s of think time. With this closed model (a fixed number of VUs, each waiting for its response before going on), the request rate is set by the think time and by the service's speed together: if the service slowed down, each VU would send fewer requests and the load would drop exactly when the service struggles. An open model (`ramping-arrival-rate`) keeps the rate fixed whatever the latency; see the exercise README.

**`NETWORK`.** 12 MB received for 6,403 responses, about 1.9 KB each, mostly the 20-issue lists. Useful for capacity planning of a load balancer or a NAT gateway, and to spot responses that grew without anyone noticing.

## What the service saw at the same time

Every request also wrote an EMF line on the service's stdout (see the observability exercise). Computed from those lines:

| Route          | Requests | p50     | p95     | p99     | Max      | 5xx |
| -------------- | -------- | ------- | ------- | ------- | -------- | --- |
| `/issues`      | 3,201    | 3.05 ms | 4.34 ms | 6.47 ms | 40.02 ms | 0   |
| `/issues/:key` | 3,201    | 2.47 ms | 3.51 ms | 5.18 ms | 30.09 ms | 0   |

- **Client and server measure different things.** The service's p95 for `/issues` is 4.3 ms, k6's is 7.8 ms. The difference is the round trip between the k6 container and the host through Docker Desktop's network. Users feel k6's number; the service controls only its own. Alarms belong on the service's metrics, load-test verdicts on the client's.
- **The p95 per 10-second window stayed between 3.6 and 6.5 ms for the whole run, spike included.** At this load the service is nowhere near a limit.
- **The slowest requests are new connections.** The maximum (40 ms) is the very first request, and a 33 ms one came at 99 s, while the spike was ramping up: the pool opens connections only when it needs them, and a new Postgres connection costs tens of milliseconds. A warm-up before measuring, or a minimum number of pooled connections, removes that from the tail.

## What this run does not prove

The verdict is "the service meets its objectives at about 100 requests per second on this laptop", nothing more:

- One instance, one small database whose 3,000 rows fit in memory, no other traffic, and a client on the same machine.
- A 2m40s run cannot show leaks, connection churn or a slowly filling queue; a soak test of an hour or more at the sustained level can.
- The breaking point is unknown. A stress run raises the load until a threshold fails, for example `npm run load-test -- --stage 1m:100 --stage 3m:300 --stage 30s:0` (each `--stage` replaces the script's stages), and the first resource to saturate (event loop, database pool, database CPU) is the weak point to put in the report.

Fill in [`report-template.md`](./report-template.md) with these numbers and those limits stated, so nobody reads "passed" as "ready for any load".
