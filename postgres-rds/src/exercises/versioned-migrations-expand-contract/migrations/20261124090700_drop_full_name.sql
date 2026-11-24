-- migrate:up
-- Contract. Deploy only once no app v1 instance is left: v1 still reads and writes full_name.
SET LOCAL lock_timeout = '5s';
DROP TRIGGER people_sync_names ON people;
DROP FUNCTION people_sync_names();
ALTER TABLE people DROP COLUMN full_name;

-- migrate:down
-- Irreversible on purpose: the dropped column's data is gone. Roll forward with a new migration, or
-- restore the snapshot taken before this step.
DO $$
BEGIN
  RAISE EXCEPTION 'drop_full_name cannot be rolled back: roll forward or restore the snapshot';
END
$$;
