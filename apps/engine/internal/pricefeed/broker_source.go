package pricefeed

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/session"
)

// BrokerSource quotes the watch list through one account's broker session
// (ENGINE_PRICE_ACCOUNT_ID), which should use stored credentials.
// Only the feed's goroutine calls Prices, so conn needs no lock.
type BrokerSource struct {
	broker    string
	accountID uuid.UUID
	sessions  *session.Manager
	now       func() time.Time
	conn      *session.Conn
}

func NewBrokerSource(brokerName string, accountID uuid.UUID, sessions *session.Manager, now func() time.Time) *BrokerSource {
	return &BrokerSource{broker: brokerName, accountID: accountID, sessions: sessions, now: now}
}

func (s *BrokerSource) Name() string { return s.broker }

func (s *BrokerSource) Prices(ctx context.Context, insts []broker.Instrument) (map[string]int64, error) {
	if s.conn == nil || !s.now().Before(s.conn.Session.ExpiresAt.Add(-time.Minute)) {
		conn, err := s.sessions.Connect(ctx, s.accountID)
		if err != nil {
			return nil, fmt.Errorf("price account session: %w", err)
		}
		if conn.Account.Broker != s.broker {
			return nil, fmt.Errorf("price account is on %s, not %s", conn.Account.Broker, s.broker)
		}
		s.conn = &conn
	}

	bq, ok := s.conn.Broker.(broker.BatchQuoter)
	if !ok {
		return nil, fmt.Errorf("%s cannot quote in batches", s.broker)
	}
	prices, err := bq.LastPrices(ctx, s.conn.Session, insts)
	if err != nil {
		err = s.sessions.Observe(ctx, s.accountID, err)
		s.conn = nil // log in again next tick
		return nil, err
	}
	return prices, nil
}
