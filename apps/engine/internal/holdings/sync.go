// Package holdings handles holdings_sync: the broker's positions replace ours in one transaction.
package holdings

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"bargad/engine/internal/db"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/platform/postgres"
	"bargad/engine/internal/session"
)

type Syncer struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	sessions *session.Manager
	now      func() time.Time
	log      *slog.Logger
}

func NewSyncer(pool *pgxpool.Pool, sessions *session.Manager, now func() time.Time, log *slog.Logger) *Syncer {
	return &Syncer{pool: pool, q: db.New(pool), sessions: sessions, now: now, log: log.With("component", "holdings")}
}

func (s *Syncer) Handle(ctx context.Context, job jobs.Job) error {
	p, err := jobs.Decode[jobs.HoldingsSync](job.Payload)
	if err != nil {
		return err
	}
	conn, err := s.sessions.Connect(ctx, p.BrokerAccountID)
	if err != nil {
		return session.JobOutcome(err, s.now().Add(time.Hour))
	}
	list, err := conn.Broker.Holdings(ctx, conn.Session)
	if err != nil {
		return fmt.Errorf("fetch holdings: %w", s.sessions.Observe(ctx, p.BrokerAccountID, err))
	}

	isins := make([]string, 0, len(list))
	for _, h := range list {
		isins = append(isins, h.ISIN)
	}
	rows, err := s.q.ResolveInstrumentsByISIN(ctx, isins)
	if err != nil {
		return fmt.Errorf("resolve instruments: %w", err)
	}
	ids := make(map[string]uuid.UUID, len(rows))
	for _, r := range rows {
		ids[r.Isin] = r.ID
	}

	syncedAt := s.now()
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		for _, h := range list {
			id, ok := ids[h.ISIN]
			if !ok {
				s.log.Warn("holding with unknown ISIN skipped", "isin", h.ISIN, "symbol", h.Symbol)
				continue
			}
			if err := q.UpsertHolding(ctx, db.UpsertHoldingParams{
				BrokerAccountID: p.BrokerAccountID,
				InstrumentID:    id,
				Quantity:        h.Quantity,
				AvgCostPaise:    h.AvgCostPaise,
				SyncedAt:        syncedAt,
			}); err != nil {
				return fmt.Errorf("upsert holding %s: %w", h.ISIN, err)
			}
		}
		if err := q.DeleteStaleHoldings(ctx, db.DeleteStaleHoldingsParams{
			BrokerAccountID: p.BrokerAccountID, SyncedAt: syncedAt,
		}); err != nil {
			return fmt.Errorf("delete stale holdings: %w", err)
		}
		return q.MarkHoldingsSynced(ctx, db.MarkHoldingsSyncedParams{ID: p.BrokerAccountID, SyncedAt: &syncedAt})
	})
	if err != nil {
		return err
	}
	s.log.Info("holdings synced", "broker_account_id", p.BrokerAccountID, "positions", len(list))
	return nil
}
