// Package app is the composition root: it builds every component from Config
// and runs them together until shutdown. No other package reads config.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/broker/dhan"
	"bargad/engine/internal/broker/fake"
	"bargad/engine/internal/broker/mstock"
	"bargad/engine/internal/cancel"
	"bargad/engine/internal/config"
	"bargad/engine/internal/db"
	"bargad/engine/internal/execution"
	"bargad/engine/internal/guard"
	"bargad/engine/internal/holdings"
	"bargad/engine/internal/invariant"
	"bargad/engine/internal/jobs"
	"bargad/engine/internal/market"
	"bargad/engine/internal/platform/health"
	"bargad/engine/internal/platform/postgres"
	"bargad/engine/internal/platform/redis"
	"bargad/engine/internal/pricefeed"
	"bargad/engine/internal/queue"
	"bargad/engine/internal/reconcile"
	"bargad/engine/internal/session"
	"bargad/engine/internal/valuation"
	"bargad/engine/internal/vault"
)

type App struct {
	cfg        config.Config
	log        *slog.Logger
	pool       *pgxpool.Pool
	rdb        *goredis.Client
	health     *health.Server
	runner     *queue.Runner
	calendar   *market.Calendar
	reconciler *reconcile.Reconciler
	invariants *invariant.Checker
	valuer     *valuation.Valuer
	feed       *pricefeed.Feed
}

// Build wires the engine. It fails if Postgres or the trading calendar can't load.
func Build(ctx context.Context, cfg config.Config, log *slog.Logger) (*App, error) {
	now := time.Now

	pool, err := postgres.Connect(ctx, cfg.DatabaseURL, int32(cfg.Queue.Workers+4)) //nolint:gosec // small config value
	if err != nil {
		return nil, err
	}
	q := db.New(pool)

	rdb, err := redis.Connect(cfg.RedisURL)
	if err != nil {
		pool.Close()
		return nil, err
	}
	if rdb == nil {
		log.Warn("REDIS_URL not set; prices won't be published (trading is unaffected)")
	}

	var v *vault.Vault
	if cfg.PrivateKey != nil {
		if v, err = vault.New(cfg.PrivateKey, cfg.KeyVersion); err != nil {
			pool.Close()
			return nil, err
		}
	} else {
		log.Warn("ENGINE_PRIVATE_KEY not set; stored-credential logins are off")
	}

	fakeBroker := fake.New(now)
	brokers := broker.NewRegistry(
		guard.Protect(fakeBroker, 50, log),
		guard.Protect(dhan.New(cfg.Dhan.BaseURL, cfg.Dhan.AuthURL, now), 10, log),
		guard.Protect(mstock.New(cfg.MStock.BaseURL, cfg.MStock.APIKey, now), 10, log),
	)
	sessions := session.NewManager(q, brokers, v, now, log)

	cal := market.NewCalendar(q, now, log)
	if err := cal.Refresh(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("load trading holidays: %w", err)
	}

	book := pricefeed.NewBook()
	executor := execution.New(execution.Deps{
		Pool: pool, Sessions: sessions, Calendar: cal, Kills: guard.NewKillSwitches(q),
		Book: book, MaxPriceAge: cfg.PriceFeed.MaxAge, Now: now, Log: log,
	})

	registry := jobs.NewRegistry()
	registry.Register(jobs.KindHoldingsSync, holdings.NewSyncer(pool, sessions, now, log).Handle)
	registry.Register(jobs.KindExecuteBasket, executor.Handle)
	registry.Register(jobs.KindCancelBasket, cancel.New(q, sessions, now, log).Handle)

	a := &App{
		cfg:  cfg,
		log:  log,
		pool: pool,
		rdb:  rdb,
		health: health.NewServer(":"+cfg.HealthPort, map[string]health.Check{
			"postgres": pool.Ping,
		}),
		runner: queue.NewRunner(pool, registry, log, queue.Options{
			WorkerID: cfg.WorkerID, Workers: cfg.Queue.Workers, Lease: cfg.Queue.Lease, Poll: cfg.Queue.PollInterval,
		}),
		calendar:   cal,
		reconciler: reconcile.New(q, sessions, now, log),
		invariants: invariant.New(q, log),
		valuer:     valuation.New(q, book, cal, now, log),
	}

	var src pricefeed.Source
	switch cfg.PriceFeed.Source {
	case "":
		log.Warn("ENGINE_PRICE_SOURCE is empty; the executor will quote brokers per order and valuations wait for prices")
	case fakeBroker.Name():
		src = fakeBroker
	case "dhan", "mstock":
		src = pricefeed.NewBrokerSource(cfg.PriceFeed.Source, cfg.PriceFeed.AccountID, sessions, now)
	default:
		pool.Close()
		return nil, fmt.Errorf("unknown ENGINE_PRICE_SOURCE %q", cfg.PriceFeed.Source)
	}
	if src != nil {
		var pub pricefeed.Publisher
		if rdb != nil {
			pub = pricefeed.NewRedisPublisher(rdb, log)
		}
		a.feed = pricefeed.NewFeed(src, q, book, pub, cfg.PriceFeed.Interval, now, log)
	}
	return a, nil
}

// Close releases connections. Call it after Run returns.
func (a *App) Close() {
	if a.rdb != nil {
		_ = a.rdb.Close() // shutting down; nothing useful to do with the error
	}
	a.pool.Close()
}
