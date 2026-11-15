// Package reconcile settles orders whose final state isn't known: lost replies,
// stale claims, open limit orders and broker-side expiry.
package reconcile

import (
	"context"
	"errors"
	"expvar"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
	"bargad/engine/internal/session"
)

const batchSize = 200

// unresolved is how many orders the last pass found without a final state.
var unresolved = expvar.NewInt("orders_unresolved")

type Reconciler struct {
	q        *db.Queries
	sessions *session.Manager
	now      func() time.Time
	log      *slog.Logger
}

func New(q *db.Queries, sessions *session.Manager, now func() time.Time, log *slog.Logger) *Reconciler {
	return &Reconciler{q: q, sessions: sessions, now: now, log: log.With("component", "reconciler")}
}

func (r *Reconciler) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := r.Once(ctx); err != nil && ctx.Err() == nil {
				r.log.Error("reconcile pass", "err", err)
			}
		}
	}
}

// Once makes one pass over unresolved orders, one session per account.
func (r *Reconciler) Once(ctx context.Context) error {
	rows, err := r.q.ListUnresolvedOrders(ctx, batchSize)
	if err != nil {
		return err
	}
	unresolved.Set(int64(len(rows)))

	conns := map[uuid.UUID]session.Conn{}
	skip := map[uuid.UUID]struct{}{}
	for _, o := range rows {
		if _, failed := skip[o.BrokerAccountID]; failed {
			continue
		}
		conn, ok := conns[o.BrokerAccountID]
		if !ok {
			conn, err = r.sessions.Connect(ctx, o.BrokerAccountID)
			if err != nil {
				r.log.Warn("cannot reconcile account", "broker_account_id", o.BrokerAccountID, "err", err)
				skip[o.BrokerAccountID] = struct{}{}
				continue
			}
			conns[o.BrokerAccountID] = conn
		}
		if err := r.resolve(ctx, conn, o); err != nil {
			err = r.sessions.Observe(ctx, o.BrokerAccountID, err)
			if errors.Is(err, broker.ErrSessionExpired) {
				skip[o.BrokerAccountID] = struct{}{} // next pass logs in fresh
			}
			r.log.Warn("resolve order", "order_id", o.ID, "err", err)
		}
	}
	return nil
}
