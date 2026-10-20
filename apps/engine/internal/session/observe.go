package session

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
)

// Observe clears the stored session when a broker call says it has expired,
// so the next Connect logs in again. It returns err unchanged.
func (m *Manager) Observe(ctx context.Context, accountID uuid.UUID, err error) error {
	if !errors.Is(err, broker.ErrSessionExpired) {
		return err
	}
	m.log.Info("broker ended the session early; clearing it", "account_id", accountID)
	if clearErr := m.q.ClearSession(ctx, accountID); clearErr != nil {
		return errors.Join(err, fmt.Errorf("clear session: %w", clearErr))
	}
	return err
}
