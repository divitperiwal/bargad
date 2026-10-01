package queue

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// listen turns NOTIFY on the jobs channel into wake-ups. A lost notification
// only costs one poll interval: the table is the state (ADR 2).
func listen(ctx context.Context, pool *pgxpool.Pool, wake chan<- struct{}, log *slog.Logger) {
	for {
		if err := listenOnce(ctx, pool, wake); err != nil && ctx.Err() == nil {
			log.Warn("job listener reconnecting", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func listenOnce(ctx context.Context, pool *pgxpool.Pool, wake chan<- struct{}) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN jobs"); err != nil {
		return err
	}
	for {
		if _, err := conn.Conn().WaitForNotification(ctx); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		select {
		case wake <- struct{}{}:
		default: // every worker already has a wake-up pending
		}
	}
}
