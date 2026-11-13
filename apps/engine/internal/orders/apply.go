// Package orders writes what a broker reports about an order onto its row.
package orders

import (
	"context"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
)

func Apply(ctx context.Context, q *db.Queries, id uuid.UUID, st broker.OrderStatus) error {
	return q.UpdateOrderFromBroker(ctx, db.UpdateOrderFromBrokerParams{
		ID:            id,
		Status:        string(st.State),
		BrokerOrderID: ptr(st.BrokerOrderID),
		FilledQty:     st.FilledQty,
		AvgFillPaise:  ptr(st.AvgFillPaise),
		RejectReason:  ptr(st.RejectReason),
	})
}

// ptr is nil for the zero value, so "" and 0 are stored as NULL.
func ptr[T comparable](v T) *T {
	var zero T
	if v == zero {
		return nil
	}
	return &v
}
