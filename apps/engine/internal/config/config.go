// Package config reads the engine's settings from the environment once, at startup.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Config is every setting the engine needs. Nothing else reads the environment.
type Config struct {
	DatabaseURL string
	RedisURL    string
	HealthPort  string
	LogLevel    string
	WorkerID    string

	PrivateKey *[32]byte
	KeyVersion int32

	Queue      Queue
	PriceFeed  PriceFeed
	Reconcile  time.Duration
	Invariants time.Duration
	Valuation  time.Duration

	Dhan   Dhan
	MStock MStock
}

type Queue struct {
	Workers      int
	Lease        time.Duration
	PollInterval time.Duration
}

type PriceFeed struct {
	Source    string    // a broker name; "fake" in development, "" turns the feed off
	AccountID uuid.UUID // whose session quotes prices when Source is a real broker
	Interval  time.Duration
	MaxAge    time.Duration // older prices are refused by the band check
}

type Dhan struct {
	BaseURL string
	AuthURL string
}

type MStock struct {
	BaseURL string
	APIKey  string
}

// Load builds a Config from getenv (os.Getenv in production) and reports every problem at once.
func Load(getenv func(string) string) (Config, error) {
	var errs []error
	add := func(err error) {
		if err != nil {
			errs = append(errs, err)
		}
	}

	cfg := Config{
		DatabaseURL: getenv("DATABASE_URL"),
		RedisURL:    getenv("REDIS_URL"),
		HealthPort:  str(getenv, "ENGINE_HEALTH_PORT", "8081"),
		LogLevel:    str(getenv, "LOG_LEVEL", "info"),
		WorkerID:    str(getenv, "ENGINE_WORKER_ID", hostname()),
		PriceFeed: PriceFeed{
			Source: str(getenv, "ENGINE_PRICE_SOURCE", "fake"),
		},
		Dhan: Dhan{
			BaseURL: str(getenv, "DHAN_BASE_URL", "https://api.dhan.co/v2"),
			AuthURL: str(getenv, "DHAN_AUTH_URL", "https://auth.dhan.co"),
		},
		MStock: MStock{
			BaseURL: str(getenv, "MSTOCK_BASE_URL", "https://api.mstock.trade/openapi/typea"),
			APIKey:  getenv("MSTOCK_API_KEY"),
		},
	}
	if cfg.DatabaseURL == "" {
		add(errors.New("DATABASE_URL is not set"))
	}

	var err error
	cfg.Queue.Workers, err = integer(getenv, "ENGINE_WORKERS", 4)
	add(err)
	cfg.Queue.Lease, err = duration(getenv, "ENGINE_JOB_LEASE", 60*time.Second)
	add(err)
	cfg.Queue.PollInterval, err = duration(getenv, "ENGINE_JOB_POLL", 5*time.Second)
	add(err)
	cfg.PriceFeed.Interval, err = duration(getenv, "ENGINE_PRICE_INTERVAL", time.Second)
	add(err)
	cfg.PriceFeed.MaxAge, err = duration(getenv, "ENGINE_PRICE_MAX_AGE", 30*time.Second)
	add(err)
	cfg.Reconcile, err = duration(getenv, "ENGINE_RECONCILE_INTERVAL", 15*time.Second)
	add(err)
	cfg.Invariants, err = duration(getenv, "ENGINE_INVARIANT_INTERVAL", time.Minute)
	add(err)
	cfg.Valuation, err = duration(getenv, "ENGINE_VALUATION_INTERVAL", 5*time.Minute)
	add(err)

	if raw := getenv("ENGINE_PRICE_ACCOUNT_ID"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			add(fmt.Errorf("ENGINE_PRICE_ACCOUNT_ID: %w", err))
		}
		cfg.PriceFeed.AccountID = id
	}
	if src := cfg.PriceFeed.Source; src != "" && src != "fake" && cfg.PriceFeed.AccountID == uuid.Nil {
		add(fmt.Errorf("ENGINE_PRICE_SOURCE=%s needs ENGINE_PRICE_ACCOUNT_ID", src))
	}

	version, err := integer(getenv, "ENGINE_KEY_VERSION", 1)
	add(err)
	cfg.KeyVersion = int32(version) //nolint:gosec // small config value

	if raw := getenv("ENGINE_PRIVATE_KEY"); raw != "" {
		key, err := decodeKey(raw)
		add(err)
		cfg.PrivateKey = key
	}

	if cfg.Queue.Workers < 1 {
		add(errors.New("ENGINE_WORKERS must be at least 1"))
	}

	return cfg, errors.Join(errs...)
}

func decodeKey(raw string) (*[32]byte, error) {
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("ENGINE_PRIVATE_KEY: %w", err)
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("ENGINE_PRIVATE_KEY: want 32 bytes, got %d", len(b))
	}
	var key [32]byte
	copy(key[:], b)
	return &key, nil
}

func str(getenv func(string) string, key, fallback string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return fallback
}

func integer(getenv func(string) string, key string, fallback int) (int, error) {
	v := getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func duration(getenv func(string) string, key string, fallback time.Duration) (time.Duration, error) {
	v := getenv(key)
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s: must be greater than zero, got %s", key, v)
	}
	return d, nil
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "engine"
	}
	return h
}
