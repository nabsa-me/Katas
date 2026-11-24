-- migrate:up
ALTER TABLE customers ADD COLUMN tax_id text;

-- migrate:down
ALTER TABLE customers DROP COLUMN tax_id;
