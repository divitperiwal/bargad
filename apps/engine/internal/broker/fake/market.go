package fake

import (
	"context"

	"bargad/engine/internal/broker"
)

// Prices moves each price a random step of up to ±0.2% and returns them by broker id.
func (b *Broker) Prices(_ context.Context, insts []broker.Instrument) (map[string]int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	out := make(map[string]int64, len(insts))
	for _, inst := range insts {
		price, ok := b.prices[inst.BrokerID]
		if !ok {
			continue
		}
		stepBps := b.rng.Int64N(41) - 20
		next := max(price+price*stepBps/10000, 1)
		b.prices[inst.BrokerID] = next
		out[inst.BrokerID] = next
	}
	return out, nil
}
