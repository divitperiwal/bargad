package session

import (
	"errors"
	"time"

	"bargad/engine/internal/jobs"
)

// JobOutcome turns a Connect error into what the job should do next.
func JobOutcome(err error, retryAt time.Time) error {
	switch {
	case errors.Is(err, ErrNoSession):
		return jobs.Defer(retryAt, "waiting for the member to log in to the broker")
	case errors.Is(err, ErrNeedsRelink), errors.Is(err, ErrAccountInactive):
		return jobs.Permanent(err)
	default:
		return err
	}
}
