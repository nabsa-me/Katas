-- migrate:up
SET LOCAL lock_timeout = '5s';
-- NOT VALID: enforced from now on for new and updated rows, existing rows are not scanned, so the
-- ACCESS EXCLUSIVE lock this needs lasts milliseconds.
ALTER TABLE people
ADD CONSTRAINT people_display_name_not_null CHECK (display_name IS NOT NULL) NOT VALID;

-- migrate:down
SET LOCAL lock_timeout = '5s';
ALTER TABLE people DROP CONSTRAINT people_display_name_not_null;
