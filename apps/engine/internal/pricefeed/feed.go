package pricefeed

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
)

const watchRefresh = 30 * time.Second

// Source returns latest prices in paise, keyed by the broker's security id.
type Source interface {
	Name() string
	Prices(ctx context.Context, insts []broker.Instrument) (map[string]int64, error)
}

type Publisher interface {
	Publish(ctx context.Context, ticks []Tick) error
}

type Tick struct {
	InstrumentID uuid.UUID `json:"instrumentId"`
	Paise        int64     `json:"paise"`
	At           time.Time `json:"at"`
}

type Feed struct {
	src      Source
	q        *db.Queries
	book     *Book
	pub      Publisher // nil when Redis is off
	interval time.Duration
	now      func() time.Time
	log      *slog.Logger

	insts []broker.Instrument
	ids   map[string]uuid.UUID // broker security id → instrument id
}

func NewFeed(src Source, q *db.Queries, book *Book, pub Publisher, interval time.Duration, now func() time.Time, log *slog.Logger) *Feed {
	return &Feed{src: src, q: q, book: book, pub: pub, interval: interval, now: now,
		log: log.With("component", "pricefeed", "source", src.Name())}
}

func (f *Feed) Run(ctx context.Context) {
	f.refreshWatch(ctx)
	watchTick := time.NewTicker(watchRefresh)
	priceTick := time.NewTicker(f.interval)
	defer watchTick.Stop()
	defer priceTick.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-watchTick.C:
			f.refreshWatch(ctx)
		case <-priceTick.C:
			f.poll(ctx)
		}
	}
}

func (f *Feed) refreshWatch(ctx context.Context) {
	rows, err := f.q.ListWatchedInstruments(ctx, f.src.Name())
	if err != nil {
		if ctx.Err() == nil {
			f.log.Warn("refresh watch list", "err", err)
		}
		return
	}
	insts := make([]broker.Instrument, 0, len(rows))
	ids := make(map[string]uuid.UUID, len(rows))
	for _, r := range rows {
		insts = append(insts, broker.Instrument{BrokerID: r.BrokerInstrumentID, Exchange: r.Exchange, Symbol: r.TradingSymbol})
		ids[r.BrokerInstrumentID] = r.ID
	}
	f.insts, f.ids = insts, ids
}

func (f *Feed) poll(ctx context.Context) {
	if len(f.insts) == 0 {
		return
	}
	prices, err := f.src.Prices(ctx, f.insts)
	if err != nil {
		if ctx.Err() == nil {
			f.log.Warn("fetch prices", "err", err)
		}
		return
	}

	at := f.now()
	ticks := make([]Tick, 0, len(prices))
	for brokerID, paise := range prices {
		id, ok := f.ids[brokerID]
		if !ok {
			continue
		}
		f.book.Set(id, Price{Paise: paise, At: at})
		ticks = append(ticks, Tick{InstrumentID: id, Paise: paise, At: at})
	}

	if f.pub != nil {
		if err := f.pub.Publish(ctx, ticks); err != nil && ctx.Err() == nil {
			f.log.Debug("publish prices", "err", err) // Redis is optional; the Book is already updated
		}
	}
}
