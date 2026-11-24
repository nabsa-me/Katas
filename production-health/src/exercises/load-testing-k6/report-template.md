# Load test report: <service> <version>

Copy this file next to the raw k6 output of the run and replace every `<…>`. Keep the limits section even when everything passed: it is what stops "passed" from being read as "ready for any load".

## Summary

- **Verdict:** <passed / failed> against the objectives below, at <peak requests per second> with <peak VUs or arrival rate>.
- **Weak points found:** <number>, of which <number> block the release (details below).
- **Decision needed:** <none / what, from whom, by when>.

## What was tested

| Item              | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Date and duration | <2026-11-24, 2m40s>                                                                     |
| Service version   | <commit SHA or image digest>                                                            |
| Environment       | <laptop / staging / production-like>; <instances>, <CPU and memory per instance>        |
| Database          | <engine, instance class, rows in the tables that matter, warm or cold cache>            |
| Script            | <path and commit of the k6 script>; k6 <version>                                        |
| Model             | <closed: ramping VUs with think time / open: ramping arrival rate>                      |
| Stages            | <ramp-up 30s → 10 VUs, sustained 1m, spike 10s → 50 VUs, hold 30s, recovery, ramp-down> |
| Traffic mix       | <one list and one issue per iteration, random status and key>                           |
| Not included      | <other traffic, background jobs, cache warm-up, third-party APIs>                       |

## Objectives and results

| Objective (threshold)       | Target | Result | Pass |
| --------------------------- | ------ | ------ | ---- |
| p95 latency, all requests   | 300 ms | <…>    | <…>  |
| p95 latency, `/issues`      | 300 ms | <…>    | <…>  |
| p95 latency, `/issues/:key` | 300 ms | <…>    | <…>  |
| Failed requests             | < 1 %  | <…>    | <…>  |
| Checks (correct responses)  | > 99 % | <…>    | <…>  |
| Peak throughput sustained   | <…>    | <…>    | <…>  |

## What the service saw

Server-side numbers for the same window, from the service's metrics and the infrastructure's dashboards. The gap between client and server latency is the network and the load balancer.

| Signal                                    | Before | Peak | After (recovery) |
| ----------------------------------------- | ------ | ---- | ---------------- |
| p95 latency per route (service metric)    | <…>    | <…>  | <…>              |
| 5xx per route                             | <…>    | <…>  | <…>              |
| CPU per instance                          | <…>    | <…>  | <…>              |
| Event loop lag (p99)                      | <…>    | <…>  | <…>              |
| Memory (RSS and heap)                     | <…>    | <…>  | <…>              |
| Database connections in use / pool `max`  | <…>    | <…>  | <…>              |
| Requests waiting for a pooled connection  | <…>    | <…>  | <…>              |
| Database CPU, slowest query (p95)         | <…>    | <…>  | <…>              |
| Instances (if autoscaling) and scale time | <…>    | <…>  | <…>              |

## Weak points and remediation plan

One row per weak point, ordered by impact. Evidence is a number from this run, never an impression. The two rows below are examples of the level of detail; replace them.

| Weak point                   | Evidence                                    | Impact                                  | Remediation                                     | Owner  | Priority | Retest criterion                      |
| ---------------------------- | ------------------------------------------- | --------------------------------------- | ----------------------------------------------- | ------ | -------- | ------------------------------------- |
| Pool saturates at 300 VUs    | <pool waiting > 0 from 2m10s; p95 → 900 ms> | <the list endpoint misses its p95>      | <raise `max` to 20 and check `max_connections`> | <team> | <P1>     | <p95 < 300 ms at 300 VUs, no waiting> |
| Cold connections in the tail | <max 40 ms on the first requests>           | <slow first requests after each deploy> | <a warm-up query before reporting ready>        | <team> | <P3>     | <max < 20 ms after a deploy>          |

## Limits of this test

- <What the environment does not represent: one instance, a small data set, the same network, no other traffic.>
- <What the duration does not show: leaks, slowly filling queues, connection churn (a soak test does).>
- <What the model does not show: with a closed model the load drops when the service slows down.>
- <Where the breaking point is, or that it was not searched for.>

## Next run

- <The scenario to run after the remediation, and what it must prove.>
- <A stress run to find the breaking point, and a soak run at the sustained level.>

## Appendix

- Raw k6 output: <link or file>
- Dashboards for the window: <links>
- Service logs for the window: <Logs Insights query>
