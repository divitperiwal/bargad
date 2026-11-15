package execution

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/db"
	"bargad/engine/internal/market"
)

// nudges remembers, per account, the IST day a login reminder was last written.
// In memory: an engine restart may send one extra reminder that day.
type nudges struct {
	mu   sync.Mutex
	last map[uuid.UUID]time.Time
}

// nudgeLogin writes broker.login_needed to the member's audit feed (their
// notifications) at most once per account per IST day.
func (e *Executor) nudgeLogin(ctx context.Context, b db.Basket, accountID uuid.UUID) {
	day := market.Day(e.now())
	e.nudged.mu.Lock()
	if last, ok := e.nudged.last[accountID]; ok && last.Equal(day) {
		e.nudged.mu.Unlock()
		return
	}
	e.nudged.last[accountID] = day
	e.nudged.mu.Unlock()

	detail, _ := json.Marshal(map[string]any{"basketId": b.ID}) // a map of a UUID always marshals
	targetType := "broker_account"
	if err := e.q.InsertAudit(ctx, db.InsertAuditParams{
		FamilyID:      &b.FamilyID,
		SubjectUserID: b.OwnerUserID,
		Action:        "broker.login_needed",
		TargetType:    &targetType,
		TargetID:      &accountID,
		Detail:        detail,
	}); err != nil {
		e.log.Warn("write login reminder", "broker_account_id", accountID, "err", err)
	}
}
