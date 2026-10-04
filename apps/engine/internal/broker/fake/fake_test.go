package fake

import (
	"context"
	"sync"
	"testing"
	"time"

	"bargad/engine/internal/broker"
)

func TestConcurrentSameTagPlacesOnce(t *testing.T) {
	b := New(time.Now)
	ctx := context.Background()
	s, _ := b.Login(ctx, "FAKE-ANIL", broker.Credentials{})
	infy := broker.Instrument{BrokerID: "INFY", Exchange: "NSE", Symbol: "INFY"}
	req := broker.OrderRequest{Tag: "order-1", Instrument: infy, Side: broker.Buy, Quantity: 5, LimitPaise: 160000}

	const workers = 50
	ids := make(chan string, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			st, err := b.PlaceOrder(ctx, s, req)
			if err != nil {
				t.Errorf("PlaceOrder: %v", err)
				return
			}
			ids <- st.BrokerOrderID
		})
		wg.Go(func() { _, _ = b.Prices(ctx, []broker.Instrument{infy}) }) // moves prices concurrently
		wg.Go(func() { _, _ = b.Holdings(ctx, s) })
	}
	wg.Wait()
	close(ids)

	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatalf("same tag gave two orders: %s and %s", first, id)
		}
	}

	st, err := b.FindOrder(ctx, s, "order-1")
	if err != nil {
		t.Fatal(err)
	}
	want := int64(15)
	if st.State == broker.StateFilled {
		want += 5
	}
	holdings, _ := b.Holdings(ctx, s)
	for _, h := range holdings {
		if h.Symbol == "INFY" && h.Quantity != want {
			t.Errorf("INFY quantity = %d, want %d (state %s)", h.Quantity, want, st.State)
		}
	}
}
