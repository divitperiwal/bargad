package execution

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
	"bargad/engine/internal/orders"
	"bargad/engine/internal/session"
)

// send places a claimed order. Only a certain outcome is final; anything else
// is unknown, never resent, and settled by the reconciler (guarantee 4).
func (e *Executor) send(ctx context.Context, conn *session.Conn, orderID uuid.UUID, it pricedItem) {
	st, err := conn.Broker.PlaceOrder(ctx, conn.Session, broker.OrderRequest{
		Tag:        orderID.String(),
		Instrument: it.instrument(),
		Side:       broker.Side(it.Side),
		Quantity:   it.Quantity,
		LimitPaise: it.limit,
	})

	// The result must be written even if the job's deadline has just passed.
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	log := e.log.With("order_id", orderID, "symbol", it.TradingSymbol, "side", it.Side)

	var (
		rejected *broker.RejectedError
		recErr   error
	)
	switch {
	case err == nil:
		recErr = e.recordSent(rctx, orderID, st)
		log.Info("order sent", "broker_order_id", st.BrokerOrderID, "state", st.State)
	case errors.As(err, &rejected):
		_, recErr = e.q.MarkOrderRejected(rctx, db.MarkOrderRejectedParams{ID: orderID, Reason: rejected.Reason})
		log.Warn("order rejected by broker", "reason", rejected.Reason)
	case errors.Is(err, broker.ErrSessionExpired):
		_ = e.sessions.Observe(rctx, conn.Account.ID, err) // same error back; the rejection below records it
		_, recErr = e.q.MarkOrderRejected(rctx, db.MarkOrderRejectedParams{ID: orderID, Reason: "not sent: " + err.Error()})
		log.Warn("order not sent: session expired", "err", err)
	case errors.Is(err, broker.ErrNotSent):
		_, recErr = e.q.MarkOrderRejected(rctx, db.MarkOrderRejectedParams{ID: orderID, Reason: "not sent: " + err.Error()})
		log.Warn("order not sent", "err", err)
	default:
		_, recErr = e.q.MarkOrderUnknown(rctx, orderID)
		log.Warn("order outcome unknown; the reconciler will settle it", "err", err)
	}
	if recErr != nil {
		// The row stays 'claimed'; the reconciler picks up old claims.
		log.Error("record order result", "err", recErr)
	}
}

func (e *Executor) recordSent(ctx context.Context, orderID uuid.UUID, st broker.OrderStatus) error {
	brokerID := st.BrokerOrderID
	if _, err := e.q.MarkOrderSent(ctx, db.MarkOrderSentParams{ID: orderID, Status: "sent", BrokerOrderID: &brokerID}); err != nil {
		return err
	}
	if st.State == "" {
		return nil
	}
	return orders.Apply(ctx, e.q, orderID, st)
}
