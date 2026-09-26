package queue

import (
	"context"
	"errors"
	"time"

	"bargad/engine/internal/db"
	"bargad/engine/internal/jobs"
)

// finish records a handler's result. It uses its own timeout so a job that
// timed out, or a shutdown, can still be written down.
func (r *Runner) finish(parent context.Context, job jobs.Job, err error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
	defer cancel()

	log := r.log.With("job_id", job.ID, "kind", job.Kind, "attempt", job.Attempt)
	var (
		deferred  *jobs.DeferError
		permanent *jobs.PermanentError
		n         int64
		dbErr     error
	)

	switch {
	case err == nil:
		n, dbErr = r.q.CompleteJob(ctx, db.CompleteJobParams{ID: job.ID, Worker: r.workerID})
		log.Info("job done")
	case errors.As(err, &deferred):
		n, dbErr = r.q.DeferJob(ctx, db.DeferJobParams{
			ID: job.ID, Worker: r.workerID, RunAt: deferred.Until, Reason: deferred.Reason,
		})
		log.Info("job deferred", "until", deferred.Until, "reason", deferred.Reason)
	case errors.As(err, &permanent):
		n, dbErr = r.q.KillJob(ctx, db.KillJobParams{ID: job.ID, Worker: r.workerID, Error: err.Error()})
		log.Error("job dead", "err", err)
	default:
		delay := retryDelay(job.Attempt)
		n, dbErr = r.q.FailJob(ctx, db.FailJobParams{
			ID: job.ID, Worker: r.workerID, Error: err.Error(), RetryInSeconds: int32(delay.Seconds()),
		})
		if job.LastAttempt() {
			log.Error("job dead after last attempt", "err", err)
		} else {
			log.Warn("job failed, will retry", "err", err, "retry_in", delay)
		}
	}

	if dbErr != nil {
		log.Error("record job outcome", "err", dbErr)
	} else if n == 0 {
		log.Warn("lease lost before the outcome was recorded")
	}
}
