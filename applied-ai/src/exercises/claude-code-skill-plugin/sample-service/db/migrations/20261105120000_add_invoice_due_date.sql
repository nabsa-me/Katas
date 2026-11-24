-- migrate:up
ALTER TABLE invoices ADD COLUMN due_date date;

-- migrate:down
ALTER TABLE invoices DROP COLUMN due_date;
