// Package execution handles execute_basket: preflight, price, claim, send.
// The job's lane is the broker account, so one run per account at a time (guarantee 5).
package execution

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"bargad/engine/internal/db"
	"bargad/engine/internal/guard"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/market"
	"bargad/engine/internal/pricefeed"
	"bargad/engine/internal/session"
)

type Executor struct {
	pool        *pgxpool.Pool
	q           *db.Queries
	sessions    *session.Manager
	calendar    *market.Calendar
	kills       *guard.KillSwitches
	book        *pricefeed.Book
	maxPriceAge time.Duration
	now         func() time.Time
	log         *slog.Logger
	nudged      *nudges
}

type Deps struct {
	Pool        *pgxpool.Pool
	Sessions    *session.Manager
	Calendar    *market.Calendar
	Kills       *guard.KillSwitches
	Book        *pricefeed.Book
	MaxPriceAge time.Duration
	Now         func() time.Time
	Log         *slog.Logger
}

func New(d Deps) *Executor {
	return &Executor{
		pool: d.Pool, q: db.New(d.Pool), sessions: d.Sessions, calendar: d.Calendar, kills: d.Kills,
		book: d.Book, maxPriceAge: d.MaxPriceAge, now: d.Now, log: d.Log.With("component", "executor"),
		nudged: &nudges{last: make(map[uuid.UUID]time.Time)},
	}
}

func (e *Executor) Handle(ctx context.Context, job jobs.Job) error {
	p, err := jobs.Decode[jobs.ExecuteBasket](job.Payload)
	if err != nil {
		return err
	}
	return e.run(ctx, p)
}

func (e *Executor) run(ctx context.Context, p jobs.ExecuteBasket) error {
	log := e.log.With("basket_id", p.BasketID, "broker_account_id", p.BrokerAccountID)

	basket, conn, err := e.preflight(ctx, p)
	if err != nil || conn == nil {
		return err // conn is nil when there's nothing left to do
	}

	items, err := e.q.ListPendingItems(ctx, db.ListPendingItemsParams{
		BasketID: p.BasketID, BrokerAccountID: p.BrokerAccountID,
	})
	if err != nil {
		return fmt.Errorf("list pending items: %w", err)
	}

	priced, ok, err := e.price(ctx, conn, basket, items)
	if err != nil || !ok {
		return err // !ok: the band broke and the approval has ended
	}

	for _, item := range priced {
		orderID, err := e.claim(ctx, basket.ID, conn, item)
		var refused *refusal
		switch {
		case errors.Is(err, errAlreadyClaimed):
			continue
		case errors.Is(err, errBasketStopped):
			log.Info("basket stopped while running")
			return nil
		case errors.As(err, &refused):
			log.Warn("basket refused at claim", "reason", refused.reason)
			return e.cancelBasket(ctx, basket, refused.reason)
		case err != nil:
			return fmt.Errorf("claim order: %w", err)
		}
		e.send(ctx, conn, orderID, item)
	}

	return e.finishIfComplete(ctx, basket.ID)
}

func (e *Executor) finishIfComplete(ctx context.Context, basketID uuid.UUID) error {
	pending, err := e.q.CountItemsWithoutOrder(ctx, basketID)
	if err != nil {
		return fmt.Errorf("count pending items: %w", err)
	}
	if pending > 0 {
		return nil // other accounts' jobs still have items to send
	}
	return e.q.SetBasketStatus(ctx, db.SetBasketStatusParams{ID: basketID, Status: "done"})
}
