package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"bargad/engine/internal/db"
	"bargad/engine/internal/market"
	"bargad/engine/internal/platform/postgres"
	"bargad/engine/internal/session"
)

var (
	errAlreadyClaimed = errors.New("item already has an order")
	errBasketStopped  = errors.New("basket stopped while running")
)

// refusal: the rules say no (revoked, over cap, member left). The basket is cancelled.
type refusal struct{ reason string }

func (r *refusal) Error() string { return "refused: " + r.reason }

func refuse(format string, args ...any) error {
	return &refusal{reason: fmt.Sprintf(format, args...)}
}

// claim rechecks everything under the basket lock and writes the order row,
// whose id is the idempotency key, before the broker is called (guarantees 2–4).
func (e *Executor) claim(ctx context.Context, basketID uuid.UUID, conn *session.Conn, it pricedItem) (uuid.UUID, error) {
	var orderID uuid.UUID
	err := postgres.InTx(ctx, e.pool, func(tx pgx.Tx) error {
		q := e.q.WithTx(tx)
		now := e.now()

		b, err := q.LockBasket(ctx, basketID)
		if err != nil {
			return fmt.Errorf("lock basket: %w", err)
		}
		if (b.Status != "queued" && b.Status != "executing") || approvalExpired(b, now) {
			return errBasketStopped
		}

		has, err := q.ItemHasOrder(ctx, it.ID)
		if err != nil {
			return err
		}
		if has {
			return errAlreadyClaimed
		}

		if b.Mode != "self" {
			if err := checkMember(ctx, q, b); err != nil {
				return err
			}
		}

		notional := it.Quantity * it.limit
		if b.Mode == "grant" {
			if err := spendGrant(ctx, q, b, conn.Account.ID, it, notional, now); err != nil {
				return err
			}
		}

		if b.Status == "queued" {
			if err := q.SetBasketStatus(ctx, db.SetBasketStatusParams{ID: b.ID, Status: "executing"}); err != nil {
				return err
			}
		}

		orderID, err = q.InsertOrder(ctx, db.InsertOrderParams{
			BasketItemID:    it.ID,
			BrokerAccountID: conn.Account.ID,
			Side:            it.Side,
			Quantity:        it.Quantity,
			RefPricePaise:   it.ref,
			BandBps:         it.band,
			LimitPricePaise: it.limit,
			TradingDay:      market.Day(now),
		})
		if err != nil {
			return fmt.Errorf("insert order: %w", err)
		}

		if b.Mode == "grant" {
			return auditGrantOrder(ctx, q, b, orderID, it, notional)
		}
		return nil
	})
	return orderID, err
}

// checkMember: the owner is still in this family with a SEBI-family relationship.
func checkMember(ctx context.Context, q *db.Queries, b db.Basket) error {
	m, err := q.GetActiveMembership(ctx, b.OwnerUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return refuse("member has left the family")
	}
	if err != nil {
		return err
	}
	if m.FamilyID != b.FamilyID {
		return refuse("member is in a different family")
	}
	if m.CanTrade == nil || !*m.CanTrade {
		return refuse("relationship does not allow trading for this member")
	}
	return nil
}

func auditGrantOrder(ctx context.Context, q *db.Queries, b db.Basket, orderID uuid.UUID, it pricedItem, notional int64) error {
	detail, err := json.Marshal(map[string]any{
		"basketId": b.ID, "grantId": b.GrantID, "symbol": it.TradingSymbol, "side": it.Side,
		"quantity": it.Quantity, "limitPaise": it.limit, "notionalPaise": notional,
	})
	if err != nil {
		return err
	}
	targetType := "order"
	return q.InsertAudit(ctx, db.InsertAuditParams{
		FamilyID:      &b.FamilyID,
		SubjectUserID: b.OwnerUserID,
		Action:        "order.placed_under_grant",
		TargetType:    &targetType,
		TargetID:      &orderID,
		Detail:        detail,
	})
}
