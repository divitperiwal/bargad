package guard

import (
	"context"
	"errors"
	"expvar"
	"fmt"
	"log/slog"
	"time"

	"github.com/sony/gobreaker/v2"
	"golang.org/x/time/rate"

	"bargad/engine/internal/broker"
)

// circuitOpen is broker_circuit_open{broker}: 1 while that broker is paused.
var circuitOpen = expvar.NewMap("broker_circuit_open")

var _ broker.Broker = (*Protected)(nil)

// Protected paces calls to one broker and pauses it after repeated failures (guarantee 6).
type Protected struct {
	inner   broker.Broker
	limiter *rate.Limiter
	cb      *gobreaker.CircuitBreaker[any]
}

func Protect(b broker.Broker, perSecond float64, log *slog.Logger) *Protected {
	name := b.Name()
	setCircuit(name, 0)
	return &Protected{
		inner:   b,
		limiter: rate.NewLimiter(rate.Limit(perSecond), 1),
		cb: gobreaker.NewCircuitBreaker[any](gobreaker.Settings{
			Name:        name,
			MaxRequests: 1,
			Interval:    time.Minute,
			Timeout:     30 * time.Second,
			// Total, not consecutive: the price feed's quotes would reset a streak of failed orders.
			ReadyToTrip: func(c gobreaker.Counts) bool { return c.TotalFailures >= 5 },
			IsSuccessful: func(err error) bool {
				var rejected *broker.RejectedError
				return err == nil ||
					errors.As(err, &rejected) ||
					errors.Is(err, broker.ErrOrderNotFound) ||
					errors.Is(err, broker.ErrSessionExpired) ||
					errors.Is(err, broker.ErrInvalidCredentials) ||
					errors.Is(err, context.Canceled)
			},
			OnStateChange: func(name string, from, to gobreaker.State) {
				open := int64(0)
				if to == gobreaker.StateOpen {
					open = 1
					log.Error("broker circuit open; its trades carry over", "broker", name)
				} else {
					log.Info("broker circuit state", "broker", name, "from", from.String(), "to", to.String())
				}
				setCircuit(name, open)
			},
		}),
	}
}

func setCircuit(name string, open int64) {
	v := new(expvar.Int)
	v.Set(open)
	circuitOpen.Set(name, v)
}

// Paused reports an open circuit; check it before claiming an order.
func (p *Protected) Paused() bool { return p.cb.State() == gobreaker.StateOpen }

func call[T any](ctx context.Context, p *Protected, fn func() (T, error)) (T, error) {
	var zero T
	if err := p.limiter.Wait(ctx); err != nil {
		return zero, fmt.Errorf("%w: %w", broker.ErrNotSent, err)
	}
	v, err := p.cb.Execute(func() (any, error) { return fn() })
	if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
		return zero, fmt.Errorf("%w: %s paused: %w", broker.ErrNotSent, p.inner.Name(), err)
	}
	out, _ := v.(T) // v is nil only when fn returned a zero value with its error
	return out, err
}

func (p *Protected) Name() string { return p.inner.Name() }

func (p *Protected) Passwordless() bool {
	pl, ok := p.inner.(broker.Passwordless)
	return ok && pl.Passwordless()
}

func (p *Protected) Login(ctx context.Context, clientID string, creds broker.Credentials) (broker.Session, error) {
	return call(ctx, p, func() (broker.Session, error) { return p.inner.Login(ctx, clientID, creds) })
}

func (p *Protected) PlaceOrder(ctx context.Context, s broker.Session, o broker.OrderRequest) (broker.OrderStatus, error) {
	return call(ctx, p, func() (broker.OrderStatus, error) { return p.inner.PlaceOrder(ctx, s, o) })
}

func (p *Protected) CancelOrder(ctx context.Context, s broker.Session, id string) error {
	_, err := call(ctx, p, func() (struct{}, error) { return struct{}{}, p.inner.CancelOrder(ctx, s, id) })
	return err
}

func (p *Protected) GetOrder(ctx context.Context, s broker.Session, id string) (broker.OrderStatus, error) {
	return call(ctx, p, func() (broker.OrderStatus, error) { return p.inner.GetOrder(ctx, s, id) })
}

func (p *Protected) FindOrder(ctx context.Context, s broker.Session, tag string) (broker.OrderStatus, error) {
	return call(ctx, p, func() (broker.OrderStatus, error) { return p.inner.FindOrder(ctx, s, tag) })
}

func (p *Protected) Holdings(ctx context.Context, s broker.Session) ([]broker.Holding, error) {
	return call(ctx, p, func() ([]broker.Holding, error) { return p.inner.Holdings(ctx, s) })
}

func (p *Protected) LastPrice(ctx context.Context, s broker.Session, inst broker.Instrument) (int64, error) {
	return call(ctx, p, func() (int64, error) { return p.inner.LastPrice(ctx, s, inst) })
}

// LastPrices forwards batch quotes, paced and breaker-guarded like every other call.
func (p *Protected) LastPrices(ctx context.Context, s broker.Session, insts []broker.Instrument) (map[string]int64, error) {
	bq, ok := p.inner.(broker.BatchQuoter)
	if !ok {
		return nil, fmt.Errorf("%s cannot quote in batches", p.inner.Name())
	}
	return call(ctx, p, func() (map[string]int64, error) { return bq.LastPrices(ctx, s, insts) })
}
