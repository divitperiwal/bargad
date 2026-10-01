// Package jobs is the contract between the API and the engine: job kinds,
// their payloads, the handler registry and the outcomes a handler can report.
package jobs

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

// Kinds, matching JOB in apps/api/src/jobs/queue.repository.ts.
const (
	KindHoldingsSync  = "holdings_sync"
	KindExecuteBasket = "execute_basket"
	KindCancelBasket  = "cancel_basket"
)

type HoldingsSync struct {
	BrokerAccountID uuid.UUID `json:"brokerAccountId"`
}

type ExecuteBasket struct {
	BasketID        uuid.UUID `json:"basketId"`
	BrokerAccountID uuid.UUID `json:"brokerAccountId"`
}

type CancelBasket struct {
	BasketID uuid.UUID `json:"basketId"`
}

// Decode parses a payload. A payload that doesn't parse never will, so the error is permanent.
func Decode[T any](payload []byte) (T, error) {
	var v T
	if err := json.Unmarshal(payload, &v); err != nil {
		return v, Permanent(fmt.Errorf("decode payload: %w", err))
	}
	return v, nil
}
