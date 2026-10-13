// Package broker is the port every broker adapter implements. Money is
// always whole paise. There is no order type: adapters only send LIMIT/CNC (ADR 4).
package broker

import (
	"context"
	"time"
)

type Broker interface {
	Name() string
	Login(ctx context.Context, clientID string, creds Credentials) (Session, error)
	PlaceOrder(ctx context.Context, s Session, o OrderRequest) (OrderStatus, error)
	CancelOrder(ctx context.Context, s Session, brokerOrderID string) error
	GetOrder(ctx context.Context, s Session, brokerOrderID string) (OrderStatus, error)
	// FindOrder looks an order up by our tag; ErrOrderNotFound if the broker never got it.
	FindOrder(ctx context.Context, s Session, tag string) (OrderStatus, error)
	Holdings(ctx context.Context, s Session) ([]Holding, error)
	LastPrice(ctx context.Context, s Session, inst Instrument) (int64, error)
}

// BatchQuoter quotes many instruments in one call, keyed by the broker's security id.
// The price feed needs it: one call per instrument per second would exceed rate limits.
type BatchQuoter interface {
	LastPrices(ctx context.Context, s Session, insts []Instrument) (map[string]int64, error)
}

// Passwordless is implemented by brokers that log in without credentials (the fake).
type Passwordless interface {
	Passwordless() bool
}

// Credentials are what the API sealed: {"pin", "totpSecret"}.
type Credentials struct {
	PIN        string `json:"pin"`
	TOTPSecret string `json:"totpSecret"`
}

type Session struct {
	ClientID  string
	Token     string
	ExpiresAt time.Time
}

type Instrument struct {
	BrokerID string // the broker's security id
	Exchange string // NSE or BSE
	Symbol   string
}

type Side string

const (
	Buy  Side = "buy"
	Sell Side = "sell"
)

type OrderRequest struct {
	Tag        string // our order id; the broker's correlation id
	Instrument Instrument
	Side       Side
	Quantity   int64
	LimitPaise int64
}

// State uses the orders.status values the engine stores.
type State string

const (
	StateOpen      State = "open"
	StatePartial   State = "partial"
	StateFilled    State = "filled"
	StateCancelled State = "cancelled"
	StateRejected  State = "rejected"
)

func (s State) Final() bool {
	return s == StateFilled || s == StateCancelled || s == StateRejected
}

type OrderStatus struct {
	BrokerOrderID string
	State         State
	FilledQty     int64
	AvgFillPaise  int64
	RejectReason  string
}

type Holding struct {
	ISIN         string
	Symbol       string
	Quantity     int64
	AvgCostPaise int64
}
