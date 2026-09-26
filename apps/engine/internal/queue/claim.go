package queue

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"bargad/engine/internal/db"
	"bargad/engine/internal/jobs"
)

const uniqueViolation = "23505"

// claim leases the next ready job. ok is false when there's nothing to do,
// including losing a lane race to another worker (jobs_one_running_per_lane).
func (r *Runner) claim(ctx context.Context) (job jobs.Job, ok bool, err error) {
	row, err := r.q.ClaimJob(ctx, db.ClaimJobParams{
		Worker:       r.workerID,
		LeaseSeconds: int32(r.lease.Seconds()),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return jobs.Job{}, false, nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return jobs.Job{}, false, nil
	}
	if err != nil {
		return jobs.Job{}, false, err
	}
	return jobs.Job{
		ID:          row.ID,
		Kind:        row.Kind,
		Payload:     row.Payload,
		Attempt:     row.Attempts,
		MaxAttempts: row.MaxAttempts,
	}, true, nil
}
