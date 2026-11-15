// Package cancel handles cancel_basket: open broker orders from the basket are cancelled.
// Orders still claimed or unknown are the reconciler's to settle.
package cancel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/orders"
	"bargad/engine/internal/session"
)

type Handler struct {
	q        *db.Queries
	sessions *session.Manager
	now      func() time.Time
	log      *slog.Logger
}

func New(q *db.Queries, sessions *session.Manager, now func() time.Time, log *slog.Logger) *Handler {
	return &Handler{q: q, sessions: sessions, now: now, log: log.With("component", "cancel")}
}

func (h *Handler) Handle(ctx context.Context, job jobs.Job) error {
	p, err := jobs.Decode[jobs.CancelBasket](job.Payload)
	if err != nil {
		return err
	}
	open, err := h.q.ListCancellableOrders(ctx, p.BasketID)
	if err != nil {
		return fmt.Errorf("list cancellable orders: %w", err)
	}

	conns := map[uuid.UUID]*session.Conn{}
	var errs []error
	for _, o := range open {
		conn, ok := conns[o.BrokerAccountID]
		if !ok {
			c, err := h.sessions.Connect(ctx, o.BrokerAccountID)
			if err != nil {
				return session.JobOutcome(err, h.now().Add(5*time.Minute))
			}
			conn = &c
			conns[o.BrokerAccountID] = conn
		}

		if err := h.cancelOne(ctx, conn, o.ID, *o.BrokerOrderID); err != nil {
			err = h.sessions.Observe(ctx, o.BrokerAccountID, err)
			errs = append(errs, fmt.Errorf("cancel %s: %w", o.ID, err))
		}
	}
	h.log.Info("basket orders cancelled", "basket_id", p.BasketID, "orders", len(open), "failed", len(errs))
	return errors.Join(errs...)
}

// cancelOne cancels, then reads the order back: it may have filled first.
func (h *Handler) cancelOne(ctx context.Context, conn *session.Conn, id uuid.UUID, brokerOrderID string) error {
	if err := conn.Broker.CancelOrder(ctx, conn.Session, brokerOrderID); err != nil && !errors.Is(err, broker.ErrOrderNotFound) {
		var rejected *broker.RejectedError
		if !errors.As(err, &rejected) { // a refusal usually means it already filled or closed
			return err
		}
	}
	st, err := conn.Broker.GetOrder(ctx, conn.Session, brokerOrderID)
	if err != nil {
		return err
	}
	return orders.Apply(ctx, h.q, id, st)
}
