CREATE TABLE order_items (id serial PRIMARY KEY, order_id bigint, sku text);
ALTER TABLE order_items ADD CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id);
