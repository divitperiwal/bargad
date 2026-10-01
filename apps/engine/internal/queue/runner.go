// Package queue runs jobs from the Postgres outbox: claim with SKIP LOCKED,
// wake on NOTIFY, lease, retry and requeue jobs whose worker died.
package queue

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	"bargad/engine/internal/db"
	"bargad/engine/internal/jobs"
)

// leaseMargin is how long before its lease runs out a job is told to stop.
const leaseMargin = 5 * time.Second

type Dispatcher interface {
	Dispatch(ctx context.Context, job jobs.Job) error
}

type Runner struct {
	pool       *pgxpool.Pool
	q          *db.Queries
	dispatcher Dispatcher
	log        *slog.Logger
	workerID   string
	workers    int
	lease      time.Duration
	poll       time.Duration
}

type Options struct {
	WorkerID string
	Workers  int
	Lease    time.Duration
	Poll     time.Duration
}

func NewRunner(pool *pgxpool.Pool, d Dispatcher, log *slog.Logger, opts Options) *Runner {
	return &Runner{
		pool:       pool,
		q:          db.New(pool),
		dispatcher: d,
		log:        log.With("component", "queue"),
		workerID:   opts.WorkerID,
		workers:    opts.Workers,
		lease:      opts.Lease,
		poll:       opts.Poll,
	}
}

// Run blocks until ctx is cancelled and every in-flight job has finished.
func (r *Runner) Run(ctx context.Context) error {
	wake := make(chan struct{}, r.workers)
	g, ctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		listen(ctx, r.pool, wake, r.log)
		return nil
	})
	g.Go(func() error {
		r.requeueExpired(ctx)
		return nil
	})
	for i := range r.workers {
		g.Go(func() error {
			r.work(ctx, wake, i)
			return nil
		})
	}
	return g.Wait()
}

func (r *Runner) work(ctx context.Context, wake <-chan struct{}, n int) {
	log := r.log.With("worker", n)
	for ctx.Err() == nil {
		job, ok, err := r.claim(ctx)
		if err != nil && ctx.Err() == nil {
			log.Error("claim job", "err", err)
		}
		if ok {
			r.process(ctx, job)
			continue // there may be more ready jobs
		}
		select {
		case <-ctx.Done():
		case <-wake:
		case <-time.After(r.poll):
		}
	}
}

func (r *Runner) process(ctx context.Context, job jobs.Job) {
	// Shutdown doesn't cut a broker call in half; the lease still bounds the job.
	jobCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), r.lease-leaseMargin)
	defer cancel()

	var err error
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
		}
		r.finish(ctx, job, err)
	}()
	err = r.dispatcher.Dispatch(jobCtx, job)
}

// requeueExpired returns jobs whose worker died to the queue (or kills them on their last attempt).
func (r *Runner) requeueExpired(ctx context.Context) {
	ticker := time.NewTicker(r.lease / 2)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := r.q.RequeueExpiredJobs(ctx)
			if err != nil && ctx.Err() == nil {
				r.log.Error("requeue expired jobs", "err", err)
			} else if n > 0 {
				r.log.Warn("requeued jobs whose lease expired", "count", n)
			}
		}
	}
}
