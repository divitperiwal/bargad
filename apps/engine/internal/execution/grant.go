package execution

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/db"
)

// spendGrant checks the grant under its row lock and records the spend before
// the broker is called. Spend is never refunded (guarantee 2).
func spendGrant(ctx context.Context, q *db.Queries, b db.Basket, accountID uuid.UUID, it pricedItem, notional int64, now time.Time) error {
	g, err := q.LockGrant(ctx, *b.GrantID)
	if err != nil {
		return fmt.Errorf("lock grant: %w", err)
	}

	switch {
	case g.RevokedAt != nil:
		return refuse("grant was revoked")
	case now.Before(g.StartsAt):
		return refuse("grant has not started")
	case !now.Before(g.ExpiresAt):
		return refuse("grant has expired")
	case g.GrantorUserID != b.OwnerUserID:
		return refuse("grant belongs to another member")
	case g.BrokerAccountID != nil && *g.BrokerAccountID != accountID:
		return refuse("grant does not cover this broker account")
	case len(g.AllowedInstrumentIds) > 0 && !slices.Contains(g.AllowedInstrumentIds, it.InstrumentID):
		return refuse("%s is not on the grant's allow-list", it.TradingSymbol)
	case notional > g.PerOrderCapPaise:
		return refuse("order of %d paise is over the per-order cap of %d", notional, g.PerOrderCapPaise)
	}

	var buy, sell int64
	if it.Side == "buy" {
		if g.BuySpentPaise+notional > g.BuyCapPaise {
			return refuse("buy would exceed the grant's cap")
		}
		buy = notional
	} else {
		if g.SellSpentPaise+notional > g.SellCapPaise {
			return refuse("sell would exceed the grant's cap")
		}
		held, err := q.GetHoldingQuantity(ctx, db.GetHoldingQuantityParams{
			BrokerAccountID: accountID, InstrumentID: it.InstrumentID,
		})
		if err != nil {
			return err
		}
		if held < it.Quantity {
			return refuse("can only sell held shares: holds %d, sell %d", held, it.Quantity)
		}
		sell = notional
	}

	return q.AddGrantSpend(ctx, db.AddGrantSpendParams{ID: g.ID, BuyPaise: buy, SellPaise: sell})
}
