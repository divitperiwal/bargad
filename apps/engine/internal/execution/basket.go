package execution

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"bargad/engine/internal/db"
	"bargad/engine/internal/platform/postgres"
)

// endApproval: the price left the approved band, so the member must approve again.
func (e *Executor) endApproval(ctx context.Context, b db.Basket, it pricedItem, live int64) error {
	e.log.Info("price left the approved band", "basket_id", b.ID, "symbol", it.TradingSymbol,
		"approved_paise", it.ref, "live_paise", live)
	return e.changeBasket(ctx, b, "basket.band_breached",
		map[string]any{"symbol": it.TradingSymbol, "approvedPaise": it.ref, "livePaise": live, "bandBps": it.band},
		func(q *db.Queries) error { return q.EndApproval(ctx, b.ID) })
}

// cancelBasket: the rules refused an order (revoked, over cap, member left).
func (e *Executor) cancelBasket(ctx context.Context, b db.Basket, reason string) error {
	return e.changeBasket(ctx, b, "basket.refused",
		map[string]any{"reason": reason},
		func(q *db.Queries) error {
			return q.SetBasketStatus(ctx, db.SetBasketStatusParams{ID: b.ID, Status: "cancelled"})
		})
}

func (e *Executor) changeBasket(ctx context.Context, b db.Basket, action string, detail map[string]any, change func(*db.Queries) error) error {
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	targetType := "basket"
	return postgres.InTx(ctx, e.pool, func(tx pgx.Tx) error {
		q := e.q.WithTx(tx)
		if err := change(q); err != nil {
			return err
		}
		return q.InsertAudit(ctx, db.InsertAuditParams{
			FamilyID:      &b.FamilyID,
			SubjectUserID: b.OwnerUserID,
			Action:        action,
			TargetType:    &targetType,
			TargetID:      &b.ID,
			Detail:        raw,
		})
	})
}
