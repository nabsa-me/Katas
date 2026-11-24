-- Fictional data for the restore drill, on the schema from the schema-design exercise.

INSERT INTO teams (slug, name)
VALUES ('platform', 'Platform'), ('payments', 'Payments'), ('data', 'Data'), ('mobile', 'Mobile');

INSERT INTO people (email, display_name)
SELECT 'person' || n || '@example.com', 'Person ' || n
FROM generate_series(1, 40) AS n;

INSERT INTO team_memberships (team_id, person_id, role, valid_from)
SELECT 1 + (p.id - 1) % 4, p.id, CASE WHEN p.id <= 4 THEN 'lead' ELSE 'member' END, date '2025-01-01'
FROM people AS p;

INSERT INTO initiatives (owner_team_id, name, status)
SELECT t.id, t.name || ' roadmap ' || n, 'active'
FROM teams AS t, generate_series(1, 3) AS n;

INSERT INTO jira_issues (
  issue_key, initiative_id, assignee_id, summary, status, story_points, custom_fields, jira_updated_at
)
SELECT
  'DRILL-' || n,
  1 + n % 12,
  1 + n % 40,
  'Issue ' || n,
  (ARRAY['todo', 'in_progress', 'done'])[1 + n % 3],
  n % 8,
  jsonb_build_object('severity', (ARRAY['low', 'high'])[1 + n % 2]),
  timestamptz '2026-01-01 00:00:00+00' + n * interval '1 hour'
FROM generate_series(1, 1000) AS n;
