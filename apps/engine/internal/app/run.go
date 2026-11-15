package app

import (
	"context"
	"time"

	"golang.org/x/sync/errgroup"
)

const holidayRefresh = time.Hour

// Run blocks until ctx is cancelled (SIGTERM) or a component fails, then
// waits for every loop to stop; in-flight jobs finish first.
func (a *App) Run(ctx context.Context) error {
	g, ctx := errgroup.WithContext(ctx)

	g.Go(func() error { return a.health.Run(ctx) })
	g.Go(func() error { return a.runner.Run(ctx) })
	g.Go(func() error { a.reconciler.Run(ctx, a.cfg.Reconcile); return nil })
	g.Go(func() error { a.invariants.Run(ctx, a.cfg.Invariants); return nil })
	g.Go(func() error { a.calendar.Run(ctx, holidayRefresh); return nil })
	g.Go(func() error { a.valuer.Run(ctx, a.cfg.Valuation); return nil })
	if a.feed != nil {
		g.Go(func() error { a.feed.Run(ctx); return nil })
	}

	a.log.Info("engine running", "worker_id", a.cfg.WorkerID, "workers", a.cfg.Queue.Workers,
		"health", ":"+a.cfg.HealthPort, "price_source", a.cfg.PriceFeed.Source)
	return g.Wait()
}
