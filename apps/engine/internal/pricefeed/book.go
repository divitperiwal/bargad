// Package pricefeed keeps the engine's own latest prices and publishes them to Redis.
// The executor reads the Book, never Redis (ADR 3).
package pricefeed

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type Price struct {
	Paise int64
	At    time.Time
}

// Book is the latest price per instrument, safe for concurrent use.
type Book struct {
	mu     sync.RWMutex
	prices map[uuid.UUID]Price
}

func NewBook() *Book {
	return &Book{prices: make(map[uuid.UUID]Price)}
}

func (b *Book) Set(id uuid.UUID, p Price) {
	b.mu.Lock()
	b.prices[id] = p
	b.mu.Unlock()
}

func (b *Book) Get(id uuid.UUID) (Price, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	p, ok := b.prices[id]
	return p, ok
}
