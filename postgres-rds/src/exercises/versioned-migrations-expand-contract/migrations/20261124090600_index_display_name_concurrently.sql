-- migrate:up transaction:false
-- CONCURRENTLY cannot run inside a transaction block, hence transaction:false. It holds SHARE UPDATE
-- EXCLUSIVE, so the application keeps inserting and updating while the index builds. If the build
-- fails, it leaves an INVALID index: drop it (DROP INDEX CONCURRENTLY) and run the migration again.
-- No lock_timeout here: CONCURRENTLY waits for older transactions to finish, and timing out would
-- leave that invalid index behind.
CREATE INDEX CONCURRENTLY people_display_name_idx ON people (display_name);

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY people_display_name_idx;
