package execution

import (
	"context"
	"errors"
	"fmt"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
	"bargad/engine/internal/guard"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/session"
)

type pricedItem struct {
	db.ListPendingItemsRow
	band  int32
	ref   int64
	limit int64
}

func (it pricedItem) instrument() broker.Instrument {
	return broker.Instrument{BrokerID: it.BrokerInstrumentID, Exchange: it.Exchange, Symbol: it.TradingSymbol}
}

// price prices every item before anything is sent. ok is false when the band
// broke: the approval has ended and nothing should be sent.
func (e *Executor) price(ctx context.Context, conn *session.Conn, basket db.Basket, items []db.ListPendingItemsRow) ([]pricedItem, bool, error) {
	out := make([]pricedItem, 0, len(items))
	for _, row := range items {
		it := pricedItem{ListPendingItemsRow: row, band: basket.BandBps}
		live, err := e.livePrice(ctx, conn, it)
		if err != nil {
			return nil, false, fmt.Errorf("price %s: %w", it.TradingSymbol, err)
		}

		it.ref = live
		if basket.Mode == "approval" {
			if it.RefPricePaise == nil {
				return nil, false, jobs.Permanent(errors.New("approved item has no reference price"))
			}
			it.ref = *it.RefPricePaise
			if !guard.InBand(live, it.ref, basket.BandBps) {
				return nil, false, e.endApproval(ctx, basket, it, live)
			}
		}

		it.limit = guard.LimitPrice(broker.Side(it.Side), it.ref, it.band, it.TickSizePaise)
		if !guard.InBand(it.limit, it.ref, it.band) {
			return nil, false, jobs.Permanent(fmt.Errorf("%s: tick %d paise is coarser than the band", it.TradingSymbol, it.TickSizePaise))
		}
		out = append(out, it)
	}
	return out, true, nil
}

// livePrice is the feed's price if fresh, else a broker quote; never Redis (ADR 3).
func (e *Executor) livePrice(ctx context.Context, conn *session.Conn, it pricedItem) (int64, error) {
	if p, ok := e.book.Get(it.InstrumentID); ok && e.now().Sub(p.At) <= e.maxPriceAge {
		return p.Paise, nil
	}
	p, err := conn.Broker.LastPrice(ctx, conn.Session, it.instrument())
	return p, e.sessions.Observe(ctx, conn.Account.ID, err)
}
