// Package fake is an in-memory broker for development, tests and the public demo.
package fake

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sort"
	"sync"
	"time"

	"bargad/engine/internal/broker"
)

var _ broker.Broker = (*Broker)(nil)

type position struct {
	quantity     int64
	avgCostPaise int64
}

type Broker struct {
	mu     sync.Mutex
	prices map[string]int64                // symbol → paise
	isins  map[string]string               // symbol → ISIN
	books  map[string]map[string]*position // client → symbol → position
	orders map[string]*order               // broker order id → order
	byTag  map[string]string               // our tag → broker order id
	nextID int
	rng    *rand.Rand
	now    func() time.Time
}

func New(now func() time.Time) *Broker {
	b := &Broker{
		prices: make(map[string]int64),
		isins:  make(map[string]string),
		books:  make(map[string]map[string]*position),
		orders: make(map[string]*order),
		byTag:  make(map[string]string),
		rng:    rand.New(rand.NewPCG(uint64(now().UnixNano()), 7)), //nolint:gosec // demo prices, not security
		now:    now,
	}
	for _, s := range seedInstruments {
		b.prices[s.symbol] = s.paise
		b.isins[s.symbol] = s.isin
	}
	for client, holdings := range seedHoldings {
		book := make(map[string]*position)
		for _, h := range holdings {
			book[h.symbol] = &position{quantity: h.quantity, avgCostPaise: h.avgCostPaise}
		}
		b.books[client] = book
	}
	return b
}

func (b *Broker) Name() string       { return "fake" }
func (b *Broker) Passwordless() bool { return true }

func (b *Broker) Login(_ context.Context, clientID string, _ broker.Credentials) (broker.Session, error) {
	now := b.now()
	midnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
	return broker.Session{ClientID: clientID, Token: "fake-" + clientID, ExpiresAt: midnight}, nil
}

func (b *Broker) Holdings(_ context.Context, s broker.Session) ([]broker.Holding, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	out := make([]broker.Holding, 0, len(b.books[s.ClientID]))
	for symbol, p := range b.books[s.ClientID] {
		if p.quantity == 0 {
			continue
		}
		out = append(out, broker.Holding{
			ISIN: b.isins[symbol], Symbol: symbol, Quantity: p.quantity, AvgCostPaise: p.avgCostPaise,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Symbol < out[j].Symbol })
	return out, nil
}

func (b *Broker) LastPrice(_ context.Context, _ broker.Session, inst broker.Instrument) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	p, ok := b.prices[inst.BrokerID]
	if !ok {
		return 0, fmt.Errorf("fake: unknown instrument %q", inst.BrokerID)
	}
	return p, nil
}
