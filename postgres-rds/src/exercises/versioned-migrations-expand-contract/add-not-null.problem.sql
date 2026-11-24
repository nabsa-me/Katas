-- migrate:up
-- A required column in one step. On a table that already has rows it fails with 23502 (not_null_violation),
-- and even with a DEFAULT to make it pass, app v1 keeps inserting rows without a real display name.
ALTER TABLE people ADD COLUMN display_name text NOT NULL;

-- migrate:down
ALTER TABLE people DROP COLUMN display_name;
