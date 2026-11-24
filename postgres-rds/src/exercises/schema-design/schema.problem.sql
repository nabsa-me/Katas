-- A document store inside Postgres: one JSONB document per row and nothing the database can check.
-- No primary keys, no foreign keys, no NOT NULL, no UNIQUE, no CHECK. Every rule (required fields, valid
-- statuses, existing references, unique emails, dates in order) lives in application code, if anywhere.

CREATE TABLE teams (
  id text,
  doc jsonb -- { "slug", "name" }
);

CREATE TABLE people (
  id text,
  doc jsonb -- { "email", "displayName", "memberships": [{ "teamId", "role", "from", "to" }] }
);

CREATE TABLE initiatives (
  id text,
  doc jsonb -- { "ownerTeamId", "name", "status", "startsOn", "endsOn" }
);

CREATE TABLE jira_issues (
  id text,
  doc jsonb -- { "key", "summary", "status", "initiativeId", "assigneeId", "storyPoints", "customFields" }
);
