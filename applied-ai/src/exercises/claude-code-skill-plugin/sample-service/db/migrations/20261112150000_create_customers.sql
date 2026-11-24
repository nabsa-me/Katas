-- migrate:up
CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);

-- migrate:down
DROP TABLE customers;
