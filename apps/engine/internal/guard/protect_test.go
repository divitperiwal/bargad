package guard

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"bargad/engine/internal/broker"
)

// halfDown quotes fine but every order times out, like an overloaded order gateway.
type halfDown struct{ broker.Broker } // unset methods panic: the test calls only these

func (halfDown) Name() string { return "halfdown" }

func (halfDown) LastPrices(context.Context, broker.Session, []broker.Instrument) (map[string]int64, error) {
	return map[string]int64{}, nil
}

func (halfDown) PlaceOrder(context.Context, broker.Session, broker.OrderRequest) (broker.OrderStatus, error) {
	return broker.OrderStatus{}, context.DeadlineExceeded
}

// The price feed's quotes go through the same breaker, so successes between
// failed orders must not keep a failing broker open.
func TestFailingOrdersPauseBrokerDespiteWorkingQuotes(t *testing.T) {
	ctx := context.Background()
	p := Protect(halfDown{}, 1000, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for i := 0; i < 10 && !p.Paused(); i++ {
		if _, err := p.LastPrices(ctx, broker.Session{}, nil); err != nil {
			t.Fatal(err)
		}
		_, _ = p.PlaceOrder(ctx, broker.Session{}, broker.OrderRequest{})
	}
	if !p.Paused() {
		t.Fatal("broker not paused after 10 timed-out orders")
	}
}
