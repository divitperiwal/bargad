package queue

import "time"

const (
	baseRetry = 5 * time.Second
	maxRetry  = 10 * time.Minute
)

// retryDelay doubles from 5s per attempt, capped at 10 minutes.
func retryDelay(attempt int32) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := baseRetry << min(attempt-1, 10)
	return min(d, maxRetry)
}
