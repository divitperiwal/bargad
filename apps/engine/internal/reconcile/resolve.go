package reconcile

import (
	"context"
	"errors"
	"time"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
	"bargad/engine/internal/orders"
	"bargad/engine/internal/session"
)

// notFoundGrace: a fresh order can briefly be missing from a broker's book.
// Job leases are shorter, so anything older can't still be in flight.
const notFoundGrace = 2 * time.Minute

func (r *Reconciler) resolve(ctx context.Context, conn session.Conn, o db.ListUnresolvedOrdersRow) error {
	var (
		st  broker.OrderStatus
		err error
	)
	if o.BrokerOrderID != nil {
		st, err = conn.Broker.GetOrder(ctx, conn.Session, *o.BrokerOrderID)
	} else {
		st, err = conn.Broker.FindOrder(ctx, conn.Session, o.ID.String())
	}

	if errors.Is(err, broker.ErrOrderNotFound) {
		if r.now().Sub(o.CreatedAt) < notFoundGrace {
			return nil
		}
		_, err := r.q.MarkOrderRejected(ctx, db.MarkOrderRejectedParams{ID: o.ID, Reason: "never reached the broker"})
		r.log.Warn("order never reached the broker", "order_id", o.ID, "was", o.Status)
		return err
	}
	if err != nil {
		return err
	}

	if string(st.State) != o.Status {
		r.log.Info("order reconciled", "order_id", o.ID, "from", o.Status, "to", st.State)
	}
	return orders.Apply(ctx, r.q, o.ID, st)
}
