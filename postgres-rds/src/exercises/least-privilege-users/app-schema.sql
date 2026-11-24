-- The application's schema, deployed by deployer (acting as migrator) after roles.sql.

CREATE TABLE teams (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE jira_issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id bigint NOT NULL REFERENCES teams (id),
  issue_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done'))
);

CREATE INDEX jira_issues_team_status ON jira_issues (team_id, status);

-- What BI may see: aggregates, not rows. The view runs with its owner's privileges, so reporting needs
-- no access to the tables underneath.
CREATE VIEW reports.open_issues_per_team AS
SELECT t.name AS team, count(i.id) FILTER (WHERE i.status <> 'done')::int AS open_issues
FROM teams AS t
LEFT JOIN jira_issues AS i ON i.team_id = t.id
GROUP BY t.name;
