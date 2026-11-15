// Package invariant looks every minute for an order that should never have
// existed. A single hit pages (guarantee 8).
package invariant

import (
	"context"
	"expvar"
	"log/slog"
	"time"

	"bargad/engine/internal/db"
)

// violations counts every violation seen; an unfixed one adds to it each pass.
var violations = expvar.NewInt("invariant_violations_total")

type Checker struct {
	q   *db.Queries
	log *slog.Logger
}

func New(q *db.Queries, log *slog.Logger) *Checker {
	return &Checker{q: q, log: log.With("component", "invariant")}
}

func (c *Checker) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := c.Once(ctx); err != nil && ctx.Err() == nil {
				c.log.Error("invariant check", "err", err)
			}
		}
	}
}

func (c *Checker) Once(ctx context.Context) (int, error) {
	rows, err := c.q.FindInvariantViolations(ctx)
	if err != nil {
		return 0, err
	}
	for _, v := range rows {
		c.log.Error("INVARIANT VIOLATION", "kind", v.Kind, "target_id", v.TargetID)
	}
	violations.Add(int64(len(rows)))
	return len(rows), nil
}
