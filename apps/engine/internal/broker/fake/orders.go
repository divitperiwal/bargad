package fake

import (
	"context"
	"strconv"

	"bargad/engine/internal/broker"
)

// circuitBps stands in for an exchange's price band: limits further away are refused.
const circuitBps = 2000

type order struct {
	id     string
	client string
	req    broker.OrderRequest
	status broker.OrderStatus
}

// PlaceOrder is idempotent by tag, like a real broker's correlation id.
func (b *Broker) PlaceOrder(_ context.Context, s broker.Session, req broker.OrderRequest) (broker.OrderStatus, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if id, ok := b.byTag[req.Tag]; ok {
		return b.orders[id].status, nil
	}

	b.nextID++
	o := &order{id: "F" + strconv.Itoa(b.nextID), client: s.ClientID, req: req}
	o.status = broker.OrderStatus{BrokerOrderID: o.id, State: broker.StateOpen}
	b.orders[o.id] = o
	b.byTag[req.Tag] = o.id

	if reason := b.validate(s.ClientID, req); reason != "" {
		o.status.State = broker.StateRejected
		o.status.RejectReason = reason
		return o.status, &broker.RejectedError{Reason: reason}
	}
	b.tryFill(o)
	return o.status, nil
}

func (b *Broker) CancelOrder(_ context.Context, _ broker.Session, brokerOrderID string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	o, ok := b.orders[brokerOrderID]
	if !ok {
		return broker.ErrOrderNotFound
	}
	b.tryFill(o)
	if !o.status.State.Final() {
		o.status.State = broker.StateCancelled
	}
	return nil
}

func (b *Broker) GetOrder(_ context.Context, _ broker.Session, brokerOrderID string) (broker.OrderStatus, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	o, ok := b.orders[brokerOrderID]
	if !ok {
		return broker.OrderStatus{}, broker.ErrOrderNotFound
	}
	b.tryFill(o)
	return o.status, nil
}

func (b *Broker) FindOrder(ctx context.Context, s broker.Session, tag string) (broker.OrderStatus, error) {
	b.mu.Lock()
	id, ok := b.byTag[tag]
	b.mu.Unlock()
	if !ok {
		return broker.OrderStatus{}, broker.ErrOrderNotFound
	}
	return b.GetOrder(ctx, s, id)
}

// validate returns a rejection reason, or "" if the order is acceptable. Caller holds mu.
func (b *Broker) validate(client string, req broker.OrderRequest) string {
	price, ok := b.prices[req.Instrument.BrokerID]
	switch {
	case !ok:
		return "unknown instrument"
	case req.Quantity <= 0:
		return "quantity must be positive"
	case req.LimitPaise*10000 < price*(10000-circuitBps) || req.LimitPaise*10000 > price*(10000+circuitBps):
		return "price outside circuit limits"
	case req.Side == broker.Sell && b.held(client, req.Instrument.BrokerID) < req.Quantity:
		return "insufficient holdings"
	}
	return ""
}

func (b *Broker) held(client, symbol string) int64 {
	if p, ok := b.books[client][symbol]; ok {
		return p.quantity
	}
	return 0
}

// tryFill fills an open order whose limit crosses the market. Caller holds mu.
func (b *Broker) tryFill(o *order) {
	if o.status.State.Final() {
		return
	}
	price := b.prices[o.req.Instrument.BrokerID]
	switch {
	case o.req.Side == broker.Buy && o.req.LimitPaise >= price,
		o.req.Side == broker.Sell && o.req.LimitPaise <= price:
	default:
		return
	}

	book, ok := b.books[o.client]
	if !ok {
		book = make(map[string]*position)
		b.books[o.client] = book
	}
	p, ok := book[o.req.Instrument.BrokerID]
	if !ok {
		p = &position{}
		book[o.req.Instrument.BrokerID] = p
	}

	qty := o.req.Quantity
	if o.req.Side == broker.Buy {
		p.avgCostPaise = (p.avgCostPaise*p.quantity + price*qty) / (p.quantity + qty)
		p.quantity += qty
	} else {
		p.quantity -= qty
	}
	o.status.State = broker.StateFilled
	o.status.FilledQty = qty
	o.status.AvgFillPaise = price
}
