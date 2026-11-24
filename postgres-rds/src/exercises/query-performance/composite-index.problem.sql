-- The range column first: the index is ordered by date, so for one team it still has to walk every
-- issue of every team inside the window and discard the other 49 teams' entries.
CREATE INDEX issues_created_at_team_id ON issues (created_at, team_id);
