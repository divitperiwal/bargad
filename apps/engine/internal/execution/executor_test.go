package execution

import (
	"context"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/broker/fake"
	"bargad/engine/internal/db"
	"bargad/engine/internal/guard"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/market"
	"bargad/engine/internal/platform/postgres"
	"bargad/engine/internal/pricefeed"
	"bargad/engine/internal/session"
)

// Seed ids from db/seed.sql.
var (
	seedFamily  = uuid.MustParse("5eed0000-0000-0000-0000-0000000000f1")
	seedRohan   = uuid.MustParse("5eed0000-0000-0000-0000-000000000001")
	seedAccount = uuid.MustParse("5eed0000-0000-0000-0000-0000000000a1")
	seedINFY    = uuid.MustParse("5eed0000-0000-0000-0000-0000000000e6")
)

var testNow = func() time.Time { return time.Date(2026, 11, 18, 10, 0, 0, 0, market.IST) } // a Wednesday

// setup needs a migrated, seeded database: ENGINE_TEST_DATABASE_URL=postgres://… go test ./internal/execution
// It creates a one-item self basket (buy 1 INFY) and an executor whose clock is 10:00 IST on a trading day.
func setup(t *testing.T) (*Executor, *pgxpool.Pool, jobs.ExecuteBasket, uuid.UUID) {
	t.Helper()
	e, pool, _ := newExecutor(t, fake.New(testNow))
	p, itemID := selfBasket(t, pool)
	return e, pool, p, itemID
}

// newExecutor wires an executor to b, behind the same breaker the engine uses.
func newExecutor(t *testing.T, b broker.Broker) (*Executor, *pgxpool.Pool, *session.Manager) {
	t.Helper()
	url := os.Getenv("ENGINE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set ENGINE_TEST_DATABASE_URL to run against Postgres")
	}
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	now := testNow

	pool, err := postgres.Connect(ctx, url, 10)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)

	cal := market.NewCalendar(q, now, log)
	if err := cal.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	brokers := broker.NewRegistry(guard.Protect(b, 1000, log))
	sessions := session.NewManager(q, brokers, nil, now, log)
	e := New(Deps{
		Pool: pool, Sessions: sessions, Calendar: cal,
		Kills: guard.NewKillSwitches(q), Book: pricefeed.NewBook(), MaxPriceAge: 30 * time.Second,
		Now: now, Log: log,
	})
	return e, pool, sessions
}

// addBasket queues a one-item basket (1 INFY) for owner on account: a self
// basket when grantID is nil, otherwise a grant basket the head created.
func addBasket(t *testing.T, pool *pgxpool.Pool, owner uuid.UUID, grantID *uuid.UUID, account uuid.UUID, side string) (basketID, itemID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	mode, createdBy := "self", owner
	if grantID != nil {
		mode, createdBy = "grant", seedRohan
	}
	basketID, itemID = uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO baskets (id, family_id, owner_user_id, created_by, mode, grant_id, status, trading_day)
		VALUES ($1, $2, $3, $4, $5, $6, 'queued', '2026-11-18')`,
		basketID, seedFamily, owner, createdBy, mode, grantID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO basket_items (id, basket_id, owner_user_id, broker_account_id, instrument_id, side, quantity)
		VALUES ($1, $2, $3, $4, $5, $6, 1)`, itemID, basketID, owner, account, seedINFY, side); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM orders WHERE basket_item_id = $1`, itemID)
		_, _ = pool.Exec(ctx, `DELETE FROM basket_items WHERE id = $1`, itemID)
		_, _ = pool.Exec(ctx, `DELETE FROM baskets WHERE id = $1`, basketID)
	})
	return basketID, itemID
}

func countOrders(t *testing.T, pool *pgxpool.Pool, itemID uuid.UUID) (int, string) {
	t.Helper()
	var count int
	var status *string
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*), max(status) FROM orders WHERE basket_item_id = $1`, itemID).Scan(&count, &status); err != nil {
		t.Fatal(err)
	}
	if status == nil {
		return count, ""
	}
	return count, *status
}

func TestExecuteBasketPlacesExactlyOnce(t *testing.T) {
	e, pool, payload, itemID := setup(t)
	ctx := context.Background()

	for run := 1; run <= 2; run++ { // the second run is a retried job after a crash
		if err := e.run(ctx, payload); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	count, status := countOrders(t, pool, itemID)
	if count != 1 {
		t.Fatalf("orders = %d, want exactly 1", count)
	}
	if status != "filled" {
		t.Errorf("order status = %s, want filled", status)
	}
	var basketStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM baskets WHERE id = $1`, payload.BasketID).Scan(&basketStatus); err != nil {
		t.Fatal(err)
	}
	if basketStatus != "done" {
		t.Errorf("basket status = %s, want done", basketStatus)
	}
}

// Without the lane index, only the claim transaction's locking stands between
// concurrent runs and a duplicate order.
func TestConcurrentRunsPlaceExactlyOnce(t *testing.T) {
	e, pool, payload, itemID := setup(t)
	ctx := context.Background()

	errs := make(chan error, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { errs <- e.run(ctx, payload) })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("run: %v", err)
		}
	}

	if count, _ := countOrders(t, pool, itemID); count != 1 {
		t.Fatalf("orders = %d, want exactly 1", count)
	}
}
