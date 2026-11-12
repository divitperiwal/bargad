package guard

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"bargad/engine/internal/db"
)

type KillSwitches struct {
	q *db.Queries
}

func NewKillSwitches(q *db.Queries) *KillSwitches { return &KillSwitches{q: q} }

// Engaged reports the first switch that blocks this family on this broker.
// An error means "can't confirm it's safe": the caller must not trade.
func (k *KillSwitches) Engaged(ctx context.Context, familyID uuid.UUID, brokerName string) (reason string, engaged bool, err error) {
	row, err := k.q.EngagedKillSwitch(ctx, db.EngagedKillSwitchParams{
		FamilyID: familyID.String(),
		Broker:   brokerName,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return row.Scope + ": " + row.Reason, true, nil
}
