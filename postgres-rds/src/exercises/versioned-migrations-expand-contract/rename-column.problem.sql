-- migrate:up
-- One step, and the app version still running breaks: every query of app v1 that names full_name now
-- fails with 42703 (undefined_column) until the new version is fully rolled out.
ALTER TABLE people RENAME COLUMN full_name TO display_name;

-- migrate:down
ALTER TABLE people RENAME COLUMN display_name TO full_name;
