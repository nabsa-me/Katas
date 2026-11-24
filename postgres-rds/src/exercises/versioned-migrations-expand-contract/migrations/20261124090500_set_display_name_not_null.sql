-- migrate:up
SET LOCAL lock_timeout = '5s';
-- The validated CHECK already proves there are no NULLs, so SET NOT NULL skips the full-table scan
-- (Postgres 12+) and its ACCESS EXCLUSIVE lock is short. The CHECK is redundant afterwards.
ALTER TABLE people ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE people DROP CONSTRAINT people_display_name_not_null;

-- migrate:down
SET LOCAL lock_timeout = '5s';
ALTER TABLE people ADD CONSTRAINT people_display_name_not_null CHECK (display_name IS NOT NULL);
ALTER TABLE people ALTER COLUMN display_name DROP NOT NULL;
