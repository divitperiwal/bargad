package broker

import "errors"

// Any other error from PlaceOrder means the outcome is unknown: the order may
// have reached the broker, so it's never resent; the reconciler settles it.
var (
	// ErrNotSent: the request never left the engine (circuit open, rate wait cancelled).
	ErrNotSent            = errors.New("request not sent")
	ErrSessionExpired     = errors.New("broker session expired")
	ErrInvalidCredentials = errors.New("broker rejected the credentials")
	ErrOrderNotFound      = errors.New("order not found at broker")
)

// RejectedError: the broker definitely refused the order.
type RejectedError struct{ Reason string }

func (e *RejectedError) Error() string { return "rejected by broker: " + e.Reason }
