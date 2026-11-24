-- migrate:up
SET LOCAL lock_timeout = '5s';
-- Scans the existing rows (all backfilled by now) holding only SHARE UPDATE EXCLUSIVE: reads and writes
-- carry on during the scan.
ALTER TABLE people VALIDATE CONSTRAINT people_display_name_not_null;

-- migrate:down
-- Nothing to undo: rolling back the previous migration drops the constraint.
