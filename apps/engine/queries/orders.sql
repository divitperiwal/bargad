-- name: InsertOrder :one
-- The id is the idempotency key: this row exists before the broker is called.
INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps,
                    limit_price_paise, trading_day)
VALUES (@basket_item_id, @broker_account_id, @side, @quantity, @ref_price_paise, @band_bps,
        @limit_price_paise, @trading_day)
RETURNING id;

-- name: MarkOrderSent :execrows
UPDATE orders
SET status = @status, broker_order_id = @broker_order_id, sent_at = now(), updated_at = now()
WHERE id = @id AND status = 'claimed';

-- name: MarkOrderUnknown :execrows
-- The reply was lost. Never resend; the reconciler asks the broker.
UPDATE orders
SET status = 'unknown', sent_at = now(), updated_at = now()
WHERE id = @id AND status = 'claimed';

-- name: MarkOrderRejected :execrows
UPDATE orders
SET status = 'rejected', reject_reason = @reason::text, updated_at = now()
WHERE id = @id AND status IN ('claimed', 'sent', 'unknown');

-- name: UpdateOrderFromBroker :exec
UPDATE orders
SET status = @status,
    broker_order_id = coalesce(sqlc.narg(broker_order_id), broker_order_id),
    filled_qty = @filled_qty,
    avg_fill_paise = sqlc.narg(avg_fill_paise),
    reject_reason = sqlc.narg(reject_reason),
    updated_at = now()
WHERE id = @id;

-- name: ListUnresolvedOrders :many
-- Orders whose final state isn't known yet. A claim this old means the sender died.
SELECT id, broker_account_id, broker_order_id, status, created_at, trading_day
FROM orders
WHERE status IN ('sent', 'unknown', 'open', 'partial')
   OR (status = 'claimed' AND created_at < now() - interval '2 minutes')
ORDER BY broker_account_id, created_at
LIMIT @max_rows;

-- name: ListCancellableOrders :many
SELECT o.id, o.broker_account_id, o.broker_order_id
FROM orders o
JOIN basket_items bi ON bi.id = o.basket_item_id
WHERE bi.basket_id = @basket_id
  AND o.status IN ('sent', 'open', 'partial')
  AND o.broker_order_id IS NOT NULL
ORDER BY o.broker_account_id;
