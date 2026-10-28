package valuation

import (
	"testing"

	"github.com/google/uuid"
)

type priceMap map[uuid.UUID]int64

func (m priceMap) get(id uuid.UUID) (int64, bool) { p, ok := m[id]; return p, ok }

func TestTotals(t *testing.T) {
	priced, partial := uuid.New(), uuid.New()
	infy, tcs, gold := uuid.New(), uuid.New(), uuid.New()
	prices := priceMap{infy: 150000, tcs: 340000}

	totals, missing := Totals([]Position{
		{AccountID: priced, InstrumentID: infy, Quantity: 10, AvgCostPaise: 140000},
		{AccountID: priced, InstrumentID: tcs, Quantity: 2, AvgCostPaise: 300000},
		{AccountID: partial, InstrumentID: infy, Quantity: 1, AvgCostPaise: 100000},
		{AccountID: partial, InstrumentID: gold, Quantity: 5, AvgCostPaise: 7000},
	}, prices.get)

	want := Total{MarketValuePaise: 10*150000 + 2*340000, InvestedPaise: 10*140000 + 2*300000}
	if got := totals[priced]; got != want {
		t.Errorf("priced account = %+v, want %+v", got, want)
	}
	if _, ok := totals[partial]; ok {
		t.Error("an account with an unpriced holding must be left out")
	}
	if len(missing) != 1 || missing[0] != partial {
		t.Errorf("missing = %v, want [%s]", missing, partial)
	}
}
