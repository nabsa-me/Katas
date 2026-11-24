-- migrate:up
-- A plain CREATE INDEX takes a SHARE lock: reads continue, but every INSERT, UPDATE and DELETE on the
-- table waits until the whole index is built. It also queues behind any open transaction that wrote to
-- the table, and the application's writes queue behind it.
CREATE INDEX people_display_name_idx ON people (display_name);

-- migrate:down
DROP INDEX people_display_name_idx;
