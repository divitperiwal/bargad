-- name: ListHoldingsForValuation :many
SELECT h.broker_account_id, h.instrument_id, h.quantity, h.avg_cost_paise
FROM holdings h
JOIN broker_accounts ba ON ba.id = h.broker_account_id
WHERE ba.status = 'active'
ORDER BY h.broker_account_id;

-- name: UpsertDailyValuation :exec
-- Rewritten through the day; the last write is the closing value.
INSERT INTO daily_valuations (broker_account_id, day, market_value_paise, invested_paise)
VALUES (@broker_account_id, @day, @market_value_paise, @invested_paise)
ON CONFLICT (broker_account_id, day) DO UPDATE
SET market_value_paise = EXCLUDED.market_value_paise,
    invested_paise = EXCLUDED.invested_paise;
