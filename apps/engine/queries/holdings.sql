-- name: ResolveInstrumentsByISIN :many
-- Brokers name securities their own way; the ISIN is the same everywhere.
SELECT id, isin
FROM instruments
WHERE exchange = 'NSE' AND isin = ANY(@isins::text[]);

-- name: UpsertHolding :exec
INSERT INTO holdings (broker_account_id, instrument_id, quantity, avg_cost_paise, synced_at)
VALUES (@broker_account_id, @instrument_id, @quantity, @avg_cost_paise, @synced_at)
ON CONFLICT (broker_account_id, instrument_id) DO UPDATE
SET quantity = EXCLUDED.quantity,
    avg_cost_paise = EXCLUDED.avg_cost_paise,
    synced_at = EXCLUDED.synced_at;

-- name: DeleteStaleHoldings :exec
-- Rows this sync didn't touch are positions the broker no longer reports.
DELETE FROM holdings
WHERE broker_account_id = @broker_account_id AND synced_at < @synced_at;

-- name: MarkHoldingsSynced :exec
UPDATE broker_accounts SET holdings_synced_at = @synced_at WHERE id = @id;

-- name: GetHoldingQuantity :one
SELECT coalesce(
  (SELECT quantity FROM holdings WHERE broker_account_id = @broker_account_id AND instrument_id = @instrument_id),
  0
)::bigint AS quantity;
