-- users and orders
CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "orders" (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  total numeric(10, 2),
  CONSTRAINT positive CHECK (total >= 0)
);
/* products */
CREATE TABLE billing.invoices (
  id serial PRIMARY KEY,
  order_id bigint,
  FOREIGN KEY (order_id) REFERENCES orders (id)
);
