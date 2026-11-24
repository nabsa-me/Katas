// Load test of the issues service. Run it with `npm run load-test` (k6 in Docker); the service must be running.
// k6 runs this file in its own JavaScript runtime, not in Node: `k6/http` and `__ENV` come from k6.
import { check, sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:5808';
const STATUSES = ['todo', 'in_progress', 'done'];

export const options = {
  // Ramp-up, sustained load at the expected peak, a sudden spike, and recovery. Short enough for a laptop; against
  // a real environment the sustained stage lasts 10 to 30 minutes, long enough for pools, caches and GC to settle.
  stages: [
    { duration: '30s', target: 10 }, // ramp-up
    { duration: '1m', target: 10 }, // sustained: the expected peak
    { duration: '10s', target: 50 }, // spike: five times the peak in ten seconds
    { duration: '30s', target: 50 }, // hold the spike
    { duration: '20s', target: 10 }, // recovery: does latency come back down?
    { duration: '10s', target: 0 }, // ramp-down
  ],
  // The pass/fail criteria, taken from the service's objectives. A failed threshold makes k6 exit with code 99,
  // so a pipeline stops on it; without thresholds a load test always "passes".
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    // Per route, through the `name` tag: an overall p95 can hide one slow endpoint behind a fast one.
    'http_req_duration{name:/issues}': ['p(95)<300'],
    'http_req_duration{name:/issues/:key}': ['p(95)<300'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** Runs once before the load: no point measuring a service that is not ready. */
export function setup() {
  const res = http.get(`${BASE_URL}/readyz`);
  if (res.status !== 200) throw new Error(`${BASE_URL}/readyz answered ${res.status}: start the service first`);
}

/** One virtual user's iteration: list a board, open an issue, pause like a person would. */
export default function () {
  const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
  // `name` groups every URL of a route under one template, like the service's own metrics.
  const list = http.get(`${BASE_URL}/issues?status=${status}&limit=20`, { tags: { name: '/issues' } });
  check(list, {
    'list answers 200': (r) => r.status === 200,
    'list has 20 issues': (r) => r.status === 200 && r.json('issues').length === 20,
  });

  const key = `PLAT-${1 + Math.floor(Math.random() * 3000)}`;
  const issue = http.get(`${BASE_URL}/issues/${key}`, { tags: { name: '/issues/:key' } });
  check(issue, { 'issue answers 200': (r) => r.status === 200 });

  // Think time. Without it each virtual user fires requests back to back, which measures how fast k6 can loop
  // rather than how the service behaves with a known number of users.
  sleep(0.5 + Math.random());
}
