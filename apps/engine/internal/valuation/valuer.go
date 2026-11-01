package valuation

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/db"
	"bargad/engine/internal/market"
	"bargad/engine/internal/pricefeed"
)

type Valuer struct {
	q        *db.Queries
	book     *pricefeed.Book
	calendar *market.Calendar
	now      func() time.Time
	log      *slog.Logger

	closedDay time.Time // today's closing snapshot is written; touched only by Run's goroutine
}

func New(q *db.Queries, book *pricefeed.Book, cal *market.Calendar, now func() time.Time, log *slog.Logger) *Valuer {
	return &Valuer{q: q, book: book, calendar: cal, now: now, log: log.With("component", "valuation")}
}

func (v *Valuer) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			now := v.now()
			closing, ok := v.due(now)
			if !ok {
				continue
			}
			if err := v.Once(ctx, market.Day(now)); err != nil {
				if ctx.Err() == nil {
					v.log.Error("write daily valuations", "err", err)
				}
				continue
			}
			if closing {
				v.closedDay = market.Day(now)
			}
		}
	}
}

// due: through market hours, then one closing snapshot per trading day.
func (v *Valuer) due(now time.Time) (closing, ok bool) {
	day := market.Day(now)
	switch {
	case v.calendar.IsOpen(now):
		return false, true
	case v.calendar.IsTradingDay(now) && !now.Before(market.Close(now)) && !v.closedDay.Equal(day):
		return true, true
	default:
		return false, false
	}
}

// Once values every active account from the engine's price book and upserts day's rows.
func (v *Valuer) Once(ctx context.Context, day time.Time) error {
	rows, err := v.q.ListHoldingsForValuation(ctx)
	if err != nil {
		return err
	}
	positions := make([]Position, 0, len(rows))
	for _, r := range rows {
		positions = append(positions, Position{
			AccountID: r.BrokerAccountID, InstrumentID: r.InstrumentID,
			Quantity: r.Quantity, AvgCostPaise: r.AvgCostPaise,
		})
	}

	totals, missing := Totals(positions, func(id uuid.UUID) (int64, bool) {
		p, ok := v.book.Get(id)
		return p.Paise, ok
	})
	for accountID, t := range totals {
		if err := v.q.UpsertDailyValuation(ctx, db.UpsertDailyValuationParams{
			BrokerAccountID:  accountID,
			Day:              day,
			MarketValuePaise: t.MarketValuePaise,
			InvestedPaise:    t.InvestedPaise,
		}); err != nil {
			return err
		}
	}
	v.log.Info("daily valuations written", "accounts", len(totals), "skipped_unpriced", len(missing))
	return nil
}
