// Package valuation writes each broker account's daily market value and
// invested amount to daily_valuations.
package valuation

import "github.com/google/uuid"

type Position struct {
	AccountID    uuid.UUID
	InstrumentID uuid.UUID
	Quantity     int64
	AvgCostPaise int64
}

type Total struct {
	MarketValuePaise int64
	InvestedPaise    int64
}

// Totals values each account. An account with any unpriced holding is left
// out and listed in missing: a partial total would look like a loss.
func Totals(positions []Position, price func(uuid.UUID) (int64, bool)) (totals map[uuid.UUID]Total, missing []uuid.UUID) {
	totals = make(map[uuid.UUID]Total)
	unpriced := make(map[uuid.UUID]struct{})

	for _, p := range positions {
		t := totals[p.AccountID]
		t.InvestedPaise += p.Quantity * p.AvgCostPaise
		if paise, ok := price(p.InstrumentID); ok {
			t.MarketValuePaise += p.Quantity * paise
		} else {
			unpriced[p.AccountID] = struct{}{}
		}
		totals[p.AccountID] = t
	}

	for id := range unpriced {
		delete(totals, id)
		missing = append(missing, id)
	}
	return totals, missing
}
