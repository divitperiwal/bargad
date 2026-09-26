package jobs

import (
	"context"
	"fmt"
)

// Job is a claimed row from the jobs table, as a handler sees it.
type Job struct {
	ID          int64
	Kind        string
	Payload     []byte
	Attempt     int32
	MaxAttempts int32
}

// LastAttempt reports whether a plain error now will kill the job.
func (j Job) LastAttempt() bool { return j.Attempt >= j.MaxAttempts }

type Handler func(ctx context.Context, job Job) error

// Registry maps job kinds to handlers. Fill it at startup, then only read it.
type Registry struct {
	handlers map[string]Handler
}

func NewRegistry() *Registry {
	return &Registry{handlers: make(map[string]Handler)}
}

// Register panics on a duplicate kind: that's a wiring bug, caught at boot.
func (r *Registry) Register(kind string, h Handler) {
	if _, exists := r.handlers[kind]; exists {
		panic("jobs: duplicate handler for " + kind)
	}
	r.handlers[kind] = h
}

func (r *Registry) Dispatch(ctx context.Context, job Job) error {
	h, ok := r.handlers[job.Kind]
	if !ok {
		return Permanent(fmt.Errorf("no handler for job kind %q", job.Kind))
	}
	return h(ctx, job)
}
