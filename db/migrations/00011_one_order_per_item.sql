-- +goose Up
-- An item is sent at most once (guarantee 4); the engine's lock is no longer the only thing enforcing it.
DROP INDEX orders_item;
CREATE UNIQUE INDEX orders_one_per_item ON orders (basket_item_id);

-- +goose Down
DROP INDEX orders_one_per_item;
CREATE INDEX orders_item ON orders (basket_item_id);
