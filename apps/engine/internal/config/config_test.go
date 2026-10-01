package config

import (
	"strings"
	"testing"
	"time"
)

func load(env map[string]string) (Config, error) {
	return Load(func(k string) string { return env[k] })
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := load(map[string]string{"DATABASE_URL": "postgres://x"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HealthPort != "8081" || cfg.Queue.Workers != 4 || cfg.Queue.Lease != time.Minute ||
		cfg.PriceFeed.Source != "fake" || cfg.PriceFeed.MaxAge != 30*time.Second || cfg.PrivateKey != nil {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadReportsEveryProblem(t *testing.T) {
	_, err := load(map[string]string{
		"ENGINE_JOB_LEASE":    "soon",
		"ENGINE_PRIVATE_KEY":  "c2hvcnQ=", // "short"
		"ENGINE_PRICE_SOURCE": "dhan",
	})
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{"DATABASE_URL", "ENGINE_JOB_LEASE", "ENGINE_PRIVATE_KEY", "ENGINE_PRICE_ACCOUNT_ID"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error doesn't mention %s: %v", want, err)
		}
	}
}

func TestLoadRejectsNonPositiveDurations(t *testing.T) {
	_, err := load(map[string]string{
		"DATABASE_URL":              "postgres://x",
		"ENGINE_JOB_POLL":           "0s",
		"ENGINE_RECONCILE_INTERVAL": "-5s",
	})
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{"ENGINE_JOB_POLL", "ENGINE_RECONCILE_INTERVAL"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error doesn't mention %s: %v", want, err)
		}
	}
}
