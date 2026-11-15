// Command engine owns every broker call: logins, orders, reconciliation and
// the price feed. It never serves the app; its only HTTP listener is for health checks

package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"bargad/engine/internal/app"
	"bargad/engine/internal/config"
	"bargad/engine/internal/platform/logger"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		slog.Error("invalid configuration", "err", err)
		os.Exit(1)
	}
	log := logger.New(os.Stdout, cfg.LogLevel)

	a, err := app.Build(ctx, cfg, log)
	if err != nil {
		log.Error("engine failed to start", "err", err)
		os.Exit(1)
	}
	defer a.Close()

	if err := a.Run(ctx); err != nil {
		log.Error("engine stopped with an error", "err", err)
		a.Close()
		os.Exit(1)
	}
	log.Info("engine stopped")
}
