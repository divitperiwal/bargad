-- name: FindInvariantViolations :many
-- Any row is a bug the executor should have made impossible. Every one pages.
WITH recent AS (
  SELECT o.id, o.side, o.notional_paise, o.created_at, b.mode, b.family_id, b.owner_user_id,
         b.approved_at, b.approval_expires_at, b.grant_id
  FROM orders o
  JOIN basket_items bi ON bi.id = o.basket_item_id
  JOIN baskets b ON b.id = bi.basket_id
  WHERE o.created_at > now() - interval '2 days'
)
SELECT 'order_without_approval'::text AS kind, r.id AS target_id
FROM recent r
WHERE r.mode = 'approval'
  AND (r.approved_at IS NULL OR r.created_at > r.approval_expires_at)

UNION ALL

SELECT 'order_outside_grant'::text, r.id
FROM recent r
JOIN grants g ON g.id = r.grant_id
WHERE r.created_at < g.starts_at
   OR r.created_at > g.expires_at
   OR (g.revoked_at IS NOT NULL AND r.created_at > g.revoked_at)

UNION ALL

SELECT 'order_after_leaving'::text, r.id
FROM recent r
WHERE r.mode <> 'self'
  AND EXISTS (
    SELECT 1 FROM family_members fm
    WHERE fm.user_id = r.owner_user_id AND fm.family_id = r.family_id AND fm.left_at < r.created_at
  )

UNION ALL

SELECT 'grant_spend_unrecorded'::text AS kind, g.id AS target_id
FROM grants g
JOIN recent r ON r.grant_id = g.id
GROUP BY g.id, g.buy_spent_paise, g.sell_spent_paise
HAVING sum(r.notional_paise) FILTER (WHERE r.side = 'buy') > g.buy_spent_paise
    OR sum(r.notional_paise) FILTER (WHERE r.side = 'sell') > g.sell_spent_paise;
