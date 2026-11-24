-- migrate:up
-- Every DDL step fails after 5 s instead of queueing behind a long transaction, because while it waits
-- for its lock, every query on the table waits behind it.
SET LOCAL lock_timeout = '5s';
-- Expand. Nullable and without a default: a catalog-only change, instant whatever the table size.
ALTER TABLE people ADD COLUMN display_name text;

-- migrate:down
SET LOCAL lock_timeout = '5s';
ALTER TABLE people DROP COLUMN display_name;
