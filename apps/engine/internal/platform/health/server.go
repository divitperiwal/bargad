// Package health is the engine's only HTTP listener (ADR 1): liveness, readiness and counters.
package health

import (
	"context"
	"encoding/json"
	"errors"
	"expvar"
	"net/http"
	"time"
)

type Check func(ctx context.Context) error

type Server struct {
	addr   string
	checks map[string]Check
}

func NewServer(addr string, checks map[string]Check) *Server {
	return &Server{addr: addr, checks: checks}
}

func (s *Server) Run(ctx context.Context) error {
	srv := &http.Server{
		Addr:              s.addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})
	mux.HandleFunc("GET /health/ready", s.ready)
	mux.Handle("GET /debug/vars", expvar.Handler())
	return mux
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	results := make(map[string]string, len(s.checks))
	status := http.StatusOK
	for name, check := range s.checks {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		err := check(ctx)
		cancel()
		if err != nil {
			results[name] = "down"
			status = http.StatusServiceUnavailable
			continue
		}
		results[name] = "ok"
	}

	body := map[string]any{"status": "ok", "checks": results}
	if status != http.StatusOK {
		body["status"] = "unavailable"
	}
	writeJSON(w, status, body)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body) // the client hung up; nothing useful to do
}
