-- migrate:up
CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE invoices;
