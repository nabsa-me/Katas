-- Fictional issues for the issues service and its load test: 3,000 rows, keys PLAT-1 to PLAT-3000.
-- Deterministic (no random(), no now()), so every fresh container holds exactly the same data.

CREATE TABLE issues (
  key text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  assignee text,
  updated_at timestamptz NOT NULL
);

INSERT INTO issues (key, title, status, assignee, updated_at)
SELECT
  'PLAT-' || n,
  (ARRAY['Rotate credentials for', 'Add a readiness probe to', 'Fix a flaky test in', 'Write the runbook for',
         'Reduce the p95 latency of'])[1 + n % 5]
    || ' the '
    || (ARRAY['ingestion job', 'issues API', 'team dashboard', 'alerting stack', 'weekly export'])[1 + (n / 5) % 5],
  (ARRAY['todo', 'in_progress', 'done'])[1 + n % 3],
  (ARRAY['Núria Camps', 'Pau Serra', 'Laia Puig', 'Marc Soler', NULL])[1 + n % 5],
  timestamptz '2026-10-01 08:00:00+00' + n * interval '13 minutes'
FROM generate_series(1, 3000) AS n;

-- Serves the list query: equality on status first, then the sort order, so the LIMIT stops early.
CREATE INDEX issues_status_updated_at_idx ON issues (status, updated_at DESC);

ANALYZE issues;
