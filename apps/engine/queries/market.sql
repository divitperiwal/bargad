-- name: ListHolidays :many
SELECT day FROM trading_holidays WHERE exchange = 'NSE' AND day >= @from_day ORDER BY day;

-- name: ListWatchedInstruments :many
-- Only what someone holds or has in a live basket gets priced.
SELECT i.id, i.exchange, i.trading_symbol, ibi.broker_instrument_id
FROM instruments i
JOIN instrument_broker_ids ibi ON ibi.instrument_id = i.id AND ibi.broker = @broker
WHERE i.id IN (
  SELECT instrument_id FROM holdings
  UNION
  SELECT bi.instrument_id
  FROM basket_items bi
  JOIN baskets b ON b.id = bi.basket_id
  WHERE b.status IN ('proposed', 'queued', 'executing')
)
ORDER BY i.trading_symbol;
