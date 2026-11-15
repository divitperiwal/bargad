package execution

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"bargad/engine/internal/db"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/session"
)

// pausable is satisfied by guard.Protected.
type pausable interface{ Paused() bool }

// preflight returns a nil conn (and nil error) when the basket needs nothing more.
func (e *Executor) preflight(ctx context.Context, p jobs.ExecuteBasket) (db.Basket, *session.Conn, error) {
	basket, err := e.q.GetBasket(ctx, p.BasketID)
	if errors.Is(err, pgx.ErrNoRows) {
		return basket, nil, jobs.Permanent(fmt.Errorf("basket %s not found", p.BasketID))
	}
	if err != nil {
		return basket, nil, fmt.Errorf("load basket: %w", err)
	}
	if basket.Status != "queued" && basket.Status != "executing" {
		e.log.Info("basket no longer runnable", "basket_id", basket.ID, "status", basket.Status)
		return basket, nil, nil
	}

	now := e.now()
	if approvalExpired(basket, now) {
		return basket, nil, e.q.SetBasketStatus(ctx, db.SetBasketStatusParams{ID: basket.ID, Status: "expired"})
	}
	if !e.calendar.IsOpen(now) {
		return basket, nil, jobs.Defer(e.calendar.NextOpen(now), "market closed")
	}

	conn, err := e.sessions.Connect(ctx, p.BrokerAccountID)
	if err != nil {
		if errors.Is(err, session.ErrNoSession) {
			e.nudgeLogin(ctx, basket, p.BrokerAccountID)
		}
		return basket, nil, session.JobOutcome(err, now.Add(10*time.Minute))
	}

	reason, engaged, err := e.kills.Engaged(ctx, basket.FamilyID, conn.Account.Broker)
	if err != nil {
		return basket, nil, fmt.Errorf("check kill switches: %w", err)
	}
	if engaged {
		return basket, nil, jobs.Defer(now.Add(time.Minute), "kill switch "+reason)
	}
	if p, ok := conn.Broker.(pausable); ok && p.Paused() {
		return basket, nil, jobs.Defer(now.Add(time.Minute), conn.Account.Broker+" circuit open")
	}
	return basket, &conn, nil
}

func approvalExpired(b db.Basket, now time.Time) bool {
	return b.Mode == "approval" && (b.ApprovalExpiresAt == nil || !now.Before(*b.ApprovalExpiresAt))
}
