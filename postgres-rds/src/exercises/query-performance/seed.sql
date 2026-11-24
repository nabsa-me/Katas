-- 50 teams and 100,000 issues. Deterministic: the same rows on every run.

CREATE TABLE teams (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id int NOT NULL REFERENCES teams (id),
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  title text NOT NULL,
  -- Millisecond precision, like a JavaScript Date, so a keyset cursor read into a Date and sent back
  -- matches the stored value exactly.
  created_at timestamptz(3) NOT NULL
);

INSERT INTO teams (name)
SELECT 'Team ' || lpad(n::text, 2, '0')
FROM generate_series(1, 50) AS n;

-- 2,000 issues per team, one every 5 minutes from 1 January 2026 (about a year). About 80% done,
-- 15% to do and 5% in progress, spread with a hash so status does not follow the team.
INSERT INTO issues (team_id, status, title, created_at)
SELECT
  1 + n % 50,
  CASE
    WHEN abs(hashint4(n)::bigint) % 100 < 5 THEN 'in_progress'
    WHEN abs(hashint4(n)::bigint) % 100 < 20 THEN 'todo'
    ELSE 'done'
  END,
  'Issue ' || n,
  timestamptz '2026-01-01 00:00:00+00' + n * interval '5 minutes'
FROM generate_series(1, 100000) AS n;
