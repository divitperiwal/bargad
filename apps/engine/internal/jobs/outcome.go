package jobs

import "time"

// A handler returns nil when done, a plain error to retry with backoff,
// Defer to wait without using an attempt, or Permanent to give up now.

// DeferError puts the job back until a time without counting a failed attempt.
type DeferError struct {
	Until  time.Time
	Reason string
}

func (e *DeferError) Error() string { return "deferred: " + e.Reason }

// Defer waits for the market to open, a kill switch to lift, a member to log in.
func Defer(until time.Time, reason string) error {
	return &DeferError{Until: until, Reason: reason}
}

// PermanentError marks the job dead: retrying can't help.
type PermanentError struct{ Err error }

func (e *PermanentError) Error() string { return e.Err.Error() }
func (e *PermanentError) Unwrap() error { return e.Err }

func Permanent(err error) error { return &PermanentError{Err: err} }
