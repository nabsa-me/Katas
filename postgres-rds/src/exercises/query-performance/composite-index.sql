-- Equality column first, then the range: all of one team's issues sit together, ordered by date, so the
-- window is one contiguous slice of the index. id last makes the order unique for keyset pagination,
-- and team_id first also serves the foreign key.
CREATE INDEX issues_team_id_created_at_id ON issues (team_id, created_at, id);
