-- name: GetBasket :one
SELECT * FROM baskets WHERE id = @id;

-- name: LockBasket :one
-- Held while the order row is claimed, so a cancel can't interleave.
SELECT * FROM baskets WHERE id = @id FOR UPDATE;

-- name: ListPendingItems :many
-- Items for one account with no order yet. Sells first, to free cash before buys.
SELECT bi.id, bi.instrument_id, bi.side, bi.quantity, bi.ref_price_paise,
       i.exchange, i.trading_symbol, i.tick_size_paise, ibi.broker_instrument_id
FROM basket_items bi
JOIN instruments i ON i.id = bi.instrument_id
JOIN broker_accounts ba ON ba.id = bi.broker_account_id
JOIN instrument_broker_ids ibi ON ibi.instrument_id = bi.instrument_id AND ibi.broker = ba.broker
WHERE bi.basket_id = @basket_id
  AND bi.broker_account_id = @broker_account_id
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.basket_item_id = bi.id)
ORDER BY bi.side DESC, bi.id;

-- name: ItemHasOrder :one
SELECT EXISTS (SELECT 1 FROM orders WHERE basket_item_id = @basket_item_id) AS has_order;

-- name: CountItemsWithoutOrder :one
SELECT count(*) AS pending
FROM basket_items bi
WHERE bi.basket_id = @basket_id
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.basket_item_id = bi.id);

-- name: GetActiveMembership :one
SELECT family_id, can_trade
FROM family_members
WHERE user_id = @user_id AND left_at IS NULL;

-- name: LockGrant :one
-- Spend is checked and recorded under this lock; a revoke takes the same lock.
SELECT * FROM grants WHERE id = @id FOR UPDATE;

-- name: AddGrantSpend :exec
-- Never refunded, even if the broker later rejects the order.
UPDATE grants
SET buy_spent_paise = buy_spent_paise + @buy_paise,
    sell_spent_paise = sell_spent_paise + @sell_paise
WHERE id = @id;

-- name: SetBasketStatus :exec
UPDATE baskets SET status = @status, updated_at = now() WHERE id = @id;

-- name: EndApproval :exec
-- The price left the approved band: the member has to approve again.
UPDATE baskets
SET status = 'proposed', approval_expires_at = now(), updated_at = now()
WHERE id = @id AND mode = 'approval';
