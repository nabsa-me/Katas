-- Teams, people, their memberships over time, initiatives owned by teams and the Jira issues synced into
-- them. The database enforces every rule that must always hold, whichever code path writes the row.

-- Lets a GiST index compare plain columns with = (needed by the exclusion constraint below).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE teams (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE people (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique whatever the case: Ada@example.com and ada@example.com are the same person.
CREATE UNIQUE INDEX people_email_unique ON people (lower(email));

CREATE TABLE team_memberships (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- CASCADE: a membership means nothing without its team or its person, so it goes with them.
  team_id bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  valid_from date NOT NULL,
  valid_to date, -- exclusive end; NULL while the membership is current
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_memberships_dates_in_order CHECK (valid_to > valid_from),
  -- The same person cannot be in the same team twice over overlapping dates.
  CONSTRAINT team_memberships_no_overlap EXCLUDE USING gist (
    person_id WITH =,
    team_id WITH =,
    daterange(valid_from, valid_to) WITH &&
  )
);

-- Team roster on a date. Also serves the foreign key on team_id; person_id is served by the
-- exclusion constraint's index, whose first column it is.
CREATE INDEX team_memberships_team_dates ON team_memberships (team_id, valid_from);

CREATE TABLE initiatives (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT: deleting a team must not silently delete the work it owns. Reassign it first.
  owner_team_id bigint NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'done', 'cancelled')),
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A CHECK that evaluates to NULL passes, so open-ended initiatives are allowed.
  CONSTRAINT initiatives_dates_in_order CHECK (ends_on >= starts_on),
  -- Also serves the foreign key on owner_team_id (first column).
  CONSTRAINT initiatives_name_per_team UNIQUE (owner_team_id, name)
);

CREATE TABLE jira_issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_key text NOT NULL UNIQUE CHECK (issue_key ~ '^[A-Z][A-Z0-9]*-[1-9][0-9]*$'),
  -- SET NULL: issues come from Jira and outlive the local initiative or the person.
  initiative_id bigint REFERENCES initiatives (id) ON DELETE SET NULL,
  assignee_id bigint REFERENCES people (id) ON DELETE SET NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  story_points numeric(4, 1) CHECK (story_points >= 0),
  -- JSONB where it fits: fields that differ per Jira project, stored and returned whole and sometimes
  -- filtered with @>. Anything joined, constrained or queried on every request gets a real column.
  custom_fields jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_fields) = 'object'),
  jira_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Initiative board (issues of an initiative by status). Also serves the foreign key on initiative_id.
CREATE INDEX jira_issues_initiative_status ON jira_issues (initiative_id, status);
-- Someone's open work. Also serves the foreign key on assignee_id.
CREATE INDEX jira_issues_assignee_status ON jira_issues (assignee_id, status);
-- Containment on custom fields: custom_fields @> '{"severity": "high"}'.
CREATE INDEX jira_issues_custom_fields ON jira_issues USING gin (custom_fields jsonb_path_ops);

CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON teams
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER people_set_updated_at BEFORE UPDATE ON people
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER team_memberships_set_updated_at BEFORE UPDATE ON team_memberships
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER initiatives_set_updated_at BEFORE UPDATE ON initiatives
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jira_issues_set_updated_at BEFORE UPDATE ON jira_issues
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
