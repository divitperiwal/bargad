package execution

// The guarantee tests from docs/design.md §5. Like executor_test.go they need
// ENGINE_TEST_DATABASE_URL and skip without it. Redis isn't covered: the
// executor takes no Redis dependency, so "Redis stopped" can't affect it.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/broker/fake"
	"bargad/engine/internal/db"
	"bargad/engine/internal/guard"
	"bargad/engine/internal/invariant"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/reconcile"
	"bargad/engine/internal/session"
)

var (
	seedPriya        = uuid.MustParse("5eed0000-0000-0000-0000-000000000002")
	seedPriyaAccount = uuid.MustParse("5eed0000-0000-0000-0000-0000000000a2")
	infyLimit        = guard.LimitPrice(broker.Buy, 152000, 100, 10) // fake INFY price, default band, INFY tick
)

// faulty is the fake broker with injected faults. places counts orders the
// engine tried to send, so a test can prove nothing was sent (or resent).
type faulty struct {
	*fake.Broker
	lostReply bool // the order is placed, then the reply is lost
	timeout   bool // the call times out before the order reaches the broker
	down      bool
	places    atomic.Int32
	calls     atomic.Int32
}

var errDown = errors.New("503 service unavailable")

func newFaulty() *faulty { return &faulty{Broker: fake.New(testNow)} }

func (f *faulty) Login(ctx context.Context, clientID string, c broker.Credentials) (broker.Session, error) {
	f.calls.Add(1)
	if f.down {
		return broker.Session{}, errDown
	}
	return f.Broker.Login(ctx, clientID, c)
}

func (f *faulty) PlaceOrder(ctx context.Context, s broker.Session, req broker.OrderRequest) (broker.OrderStatus, error) {
	f.calls.Add(1)
	f.places.Add(1)
	switch {
	case f.down:
		return broker.OrderStatus{}, errDown
	case f.timeout:
		return broker.OrderStatus{}, context.DeadlineExceeded
	}
	st, err := f.Broker.PlaceOrder(ctx, s, req)
	if f.lostReply {
		return broker.OrderStatus{}, errors.New("read tcp: connection reset by peer")
	}
	return st, err
}

// addGrant: Priya lets the head spend up to buyCap on her account, valid at testNow.
func addGrant(t *testing.T, pool *pgxpool.Pool, buyCap int64) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO grants (id, family_id, grantor_user_id, grantee_user_id, starts_at, expires_at,
		                    buy_cap_paise, sell_cap_paise, per_order_cap_paise)
		VALUES ($1, $2, $3, $4, '2026-11-18 09:00+05:30', '2026-11-20 09:00+05:30', $5, 0, 200000)`,
		id, seedFamily, seedPriya, seedRohan, buyCap); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM grants WHERE id = $1`, id) })
	return id
}

// grantBasket queues a grant basket buying 1 INFY on Priya's account.
func grantBasket(t *testing.T, pool *pgxpool.Pool, grantID uuid.UUID) (jobs.ExecuteBasket, uuid.UUID) {
	t.Helper()
	basketID, itemID := addBasket(t, pool, seedPriya, &grantID, seedPriyaAccount, "buy")
	return jobs.ExecuteBasket{BasketID: basketID, BrokerAccountID: seedPriyaAccount}, itemID
}

// selfBasket queues the head's own basket buying 1 INFY.
func selfBasket(t *testing.T, pool *pgxpool.Pool) (jobs.ExecuteBasket, uuid.UUID) {
	t.Helper()
	basketID, itemID := addBasket(t, pool, seedRohan, nil, seedAccount, "buy")
	return jobs.ExecuteBasket{BasketID: basketID, BrokerAccountID: seedAccount}, itemID
}

func basketStatus(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM baskets WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func reconcileOnce(t *testing.T, pool *pgxpool.Pool, sessions *session.Manager) {
	t.Helper()
	// Real clock: the reconciler compares it with created_at, which Postgres sets.
	r := reconcile.New(db.New(pool), sessions, time.Now, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := r.Once(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// ageOrder makes a claim look older than any job lease, as after a crash.
func ageOrder(t *testing.T, pool *pgxpool.Pool, itemID uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE orders SET created_at = now() - interval '3 minutes' WHERE basket_item_id = $1`, itemID); err != nil {
		t.Fatal(err)
	}
}

// Guarantee 2: 100 jobs spend one grant at once; exactly the cap's worth gets through.
func TestGrantCapHoldsUnderConcurrentSpend(t *testing.T) {
	e, pool, _ := newExecutor(t, fake.New(testNow))
	ctx := context.Background()
	grantID := addGrant(t, pool, 5*infyLimit)

	payloads := make([]jobs.ExecuteBasket, 100)
	for i := range payloads {
		payloads[i], _ = grantBasket(t, pool, grantID)
	}
	var wg sync.WaitGroup
	for _, p := range payloads {
		wg.Go(func() {
			if err := e.run(ctx, p); err != nil {
				t.Errorf("run: %v", err)
			}
		})
	}
	wg.Wait()

	var orders int
	var notional, spent int64
	if err := pool.QueryRow(ctx, `
		SELECT count(o.id), coalesce(sum(o.notional_paise), 0), g.buy_spent_paise
		FROM grants g
		JOIN baskets b ON b.grant_id = g.id
		JOIN basket_items bi ON bi.basket_id = b.id
		LEFT JOIN orders o ON o.basket_item_id = bi.id
		WHERE g.id = $1
		GROUP BY g.buy_spent_paise`, grantID).Scan(&orders, &notional, &spent); err != nil {
		t.Fatal(err)
	}
	if orders != 5 {
		t.Errorf("orders = %d, want 5 (cap fits exactly 5)", orders)
	}
	if notional != spent || spent > 5*infyLimit {
		t.Errorf("order notional %d, recorded spend %d, cap %d", notional, spent, 5*infyLimit)
	}
}

// Guarantee 3: once the right to trade is gone, a queued order is never sent.
func TestRefusedGrantBasketIsNeverSent(t *testing.T) {
	cases := []struct {
		name string
		stop func(ctx context.Context, pool *pgxpool.Pool, grantID uuid.UUID) error
	}{
		{"revoked", func(ctx context.Context, pool *pgxpool.Pool, grantID uuid.UUID) error {
			_, err := pool.Exec(ctx, `UPDATE grants SET revoked_at = now(), revoke_reason = 'member' WHERE id = $1`, grantID)
			return err
		}},
		{"expired", func(ctx context.Context, pool *pgxpool.Pool, grantID uuid.UUID) error {
			_, err := pool.Exec(ctx, `UPDATE grants SET starts_at = '2026-11-16 09:00+05:30', expires_at = '2026-11-17 09:00+05:30' WHERE id = $1`, grantID)
			return err
		}},
		{"member left", func(ctx context.Context, pool *pgxpool.Pool, _ uuid.UUID) error {
			_, err := pool.Exec(ctx, `UPDATE family_members SET left_at = now(), left_reason = 'left' WHERE user_id = $1 AND left_at IS NULL`, seedPriya)
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFaulty()
			e, pool, _ := newExecutor(t, f)
			ctx := context.Background()
			grantID := addGrant(t, pool, 10*infyLimit)
			p, itemID := grantBasket(t, pool, grantID)
			t.Cleanup(func() {
				_, _ = pool.Exec(context.Background(),
					`UPDATE family_members SET left_at = NULL, left_reason = NULL WHERE user_id = $1 AND left_reason = 'left'`, seedPriya)
			})

			if err := tc.stop(ctx, pool, grantID); err != nil {
				t.Fatal(err)
			}
			if err := e.run(ctx, p); err != nil {
				t.Fatalf("run: %v", err)
			}

			if n, _ := countOrders(t, pool, itemID); n != 0 {
				t.Errorf("orders = %d, want 0", n)
			}
			if n := f.places.Load(); n != 0 {
				t.Errorf("broker was asked to place %d orders, want 0", n)
			}
			if s := basketStatus(t, pool, p.BasketID); s != "cancelled" {
				t.Errorf("basket status = %s, want cancelled", s)
			}
		})
	}
}

// claimOnly runs the executor up to the committed claim and stops, as if the
// engine died right after it.
func claimOnly(t *testing.T, e *Executor, p jobs.ExecuteBasket) (uuid.UUID, pricedItem) {
	t.Helper()
	ctx := context.Background()
	basket, conn, err := e.preflight(ctx, p)
	if err != nil || conn == nil {
		t.Fatalf("preflight: %v", err)
	}
	items, err := e.q.ListPendingItems(ctx, db.ListPendingItemsParams{BasketID: p.BasketID, BrokerAccountID: p.BrokerAccountID})
	if err != nil {
		t.Fatal(err)
	}
	priced, ok, err := e.price(ctx, conn, basket, items)
	if err != nil || !ok || len(priced) != 1 {
		t.Fatalf("price: ok=%v items=%d err=%v", ok, len(priced), err)
	}
	id, err := e.claim(ctx, basket.ID, conn, priced[0])
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	return id, priced[0]
}

// Guarantee 4, crash half: the engine dies after the claim, before or after the
// broker got the order. The restarted job never resends; the reconciler settles it.
func TestCrashAfterClaimIsNeverResent(t *testing.T) {
	for _, reached := range []bool{false, true} {
		name := map[bool]string{false: "before send", true: "after send"}[reached]
		t.Run(name, func(t *testing.T) {
			f := newFaulty()
			e, pool, sessions := newExecutor(t, f)
			ctx := context.Background()
			p, itemID := selfBasket(t, pool)

			orderID, it := claimOnly(t, e, p)
			if reached { // the broker accepted it, then the engine died before recording that
				s, _ := f.Broker.Login(ctx, "FAKE-ROHAN", broker.Credentials{})
				if _, err := f.Broker.PlaceOrder(ctx, s, broker.OrderRequest{
					Tag: orderID.String(), Instrument: it.instrument(), Side: broker.Buy, Quantity: 1, LimitPaise: it.limit,
				}); err != nil {
					t.Fatal(err)
				}
			}

			if err := e.run(ctx, p); err != nil { // the job runs again after the restart
				t.Fatalf("rerun: %v", err)
			}
			if n := f.places.Load(); n != 0 {
				t.Fatalf("restarted job sent %d orders, want 0", n)
			}

			ageOrder(t, pool, itemID)
			reconcileOnce(t, pool, sessions)
			count, status := countOrders(t, pool, itemID)
			want := map[bool]string{false: "rejected", true: "filled"}[reached]
			if count != 1 || status != want {
				t.Errorf("orders = %d with status %s, want 1 %s", count, status, want)
			}
		})
	}
}

// Guarantee 4, fault half: a lost reply or a timeout leaves the order unknown;
// it is sent once and the reconciler finds out what happened.
func TestUnknownOutcomeIsReconciledNotResent(t *testing.T) {
	cases := []struct {
		name  string
		fault func(*faulty)
		want  string
	}{
		{"lost reply", func(f *faulty) { f.lostReply = true }, "filled"},
		{"timeout", func(f *faulty) { f.timeout = true }, "rejected"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFaulty()
			tc.fault(f)
			e, pool, sessions := newExecutor(t, f)
			ctx := context.Background()
			p, itemID := selfBasket(t, pool)

			for run := 1; run <= 2; run++ {
				if err := e.run(ctx, p); err != nil {
					t.Fatalf("run %d: %v", run, err)
				}
			}
			if _, status := countOrders(t, pool, itemID); status != "unknown" {
				t.Fatalf("status after send = %s, want unknown", status)
			}
			if n := f.places.Load(); n != 1 {
				t.Fatalf("broker was asked to place %d orders, want 1", n)
			}

			ageOrder(t, pool, itemID)
			reconcileOnce(t, pool, sessions)
			if count, status := countOrders(t, pool, itemID); count != 1 || status != tc.want {
				t.Errorf("orders = %d with status %s, want 1 %s", count, status, tc.want)
			}
		})
	}
}

// Guarantee 6: a broker that keeps failing is paused, so the engine stops calling it.
func TestDownBrokerIsPaused(t *testing.T) {
	f := newFaulty()
	f.down = true
	e, pool, _ := newExecutor(t, f)
	ctx := context.Background()
	p, itemID := selfBasket(t, pool)

	for range 5 { // ReadyToTrip in guard.Protect
		if err := e.run(ctx, p); err == nil {
			t.Fatal("run succeeded against a down broker")
		}
	}
	tripped := f.calls.Load()
	for range 3 {
		if err := e.run(ctx, p); err == nil {
			t.Fatal("run succeeded against a paused broker")
		}
	}
	if n := f.calls.Load(); n != tripped {
		t.Errorf("broker called %d more times after the circuit opened, want 0", n-tripped)
	}
	if n, _ := countOrders(t, pool, itemID); n != 0 {
		t.Errorf("orders = %d, want 0", n)
	}
}

// Guarantee 7: an engaged kill switch defers the job before anything is claimed.
func TestKillSwitchDefersBeforeClaim(t *testing.T) {
	f := newFaulty()
	e, pool, _ := newExecutor(t, f)
	ctx := context.Background()
	p, itemID := selfBasket(t, pool)

	if _, err := pool.Exec(ctx, `INSERT INTO kill_switches (scope, scope_key, reason) VALUES ('family', $1, 'test')`,
		seedFamily.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM kill_switches WHERE scope = 'family' AND scope_key = $1 AND reason = 'test'`,
			seedFamily.String())
	})

	err := e.run(ctx, p)
	var deferred *jobs.DeferError
	if !errors.As(err, &deferred) || !strings.Contains(deferred.Reason, "kill switch") {
		t.Fatalf("run = %v, want a kill-switch deferral", err)
	}
	if n, _ := countOrders(t, pool, itemID); n != 0 || f.places.Load() != 0 {
		t.Errorf("orders = %d, places = %d, want 0 and 0", n, f.places.Load())
	}
}

// Guarantee 8: the checker sees spend the executor failed to record.
func TestInvariantCheckerFindsUnrecordedSpend(t *testing.T) {
	e, pool, _ := newExecutor(t, fake.New(testNow))
	ctx := context.Background()
	grantID := addGrant(t, pool, 10*infyLimit)
	p, _ := grantBasket(t, pool, grantID)
	if err := e.run(ctx, p); err != nil {
		t.Fatal(err)
	}

	checker := invariant.New(db.New(pool), slog.New(slog.NewTextHandler(io.Discard, nil)))
	before, err := checker.Once(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE grants SET buy_spent_paise = 0 WHERE id = $1`, grantID); err != nil {
		t.Fatal(err)
	}
	after, err := checker.Once(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after != before+1 {
		t.Errorf("violations went from %d to %d, want one more", before, after)
	}
}
