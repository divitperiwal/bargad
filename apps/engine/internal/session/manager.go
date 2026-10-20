// Package session turns a broker account into an adapter plus a live session,
// logging in only where the member chose stored credentials.
package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"bargad/engine/internal/broker"
	"bargad/engine/internal/db"
	"bargad/engine/internal/vault"
)

var (
	// ErrNoSession: the member logs in on the broker's page and hasn't today. The trade waits.
	ErrNoSession = errors.New("no broker session; the member must log in")
	// ErrNeedsRelink: stored credentials stopped working; the member must link again.
	ErrNeedsRelink     = errors.New("broker account needs relinking")
	ErrAccountInactive = errors.New("broker account is not active")
)

const refreshMargin = time.Minute

type Account struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Broker      string
	ClientID    string
	LoginMethod string
}

// Conn is everything a broker call needs.
type Conn struct {
	Account Account
	Broker  broker.Broker
	Session broker.Session
}

type Manager struct {
	q       *db.Queries
	brokers *broker.Registry
	vault   *vault.Vault // nil: stored credentials are off
	now     func() time.Time
	log     *slog.Logger
}

func NewManager(q *db.Queries, brokers *broker.Registry, v *vault.Vault, now func() time.Time, log *slog.Logger) *Manager {
	return &Manager{q: q, brokers: brokers, vault: v, now: now, log: log.With("component", "session")}
}

func (m *Manager) Connect(ctx context.Context, accountID uuid.UUID) (Conn, error) {
	row, err := m.q.GetBrokerAccount(ctx, accountID)
	if err != nil {
		return Conn{}, fmt.Errorf("load broker account: %w", err)
	}
	if row.Status != "active" {
		return Conn{}, ErrAccountInactive
	}
	acct := Account{
		ID: row.ID, UserID: row.UserID, Broker: row.Broker,
		ClientID: row.BrokerClientID, LoginMethod: row.LoginMethod,
	}
	b, err := m.brokers.Get(acct.Broker)
	if err != nil {
		return Conn{}, err
	}

	secret, err := m.q.GetBrokerSecret(ctx, accountID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Conn{}, fmt.Errorf("load broker secret: %w", err)
	}

	if m.vault != nil && secret.SessionToken != nil && secret.SessionExpiresAt != nil &&
		secret.SessionExpiresAt.After(m.now().Add(refreshMargin)) {
		token, err := m.vault.Open(secret.SessionToken, secret.KeyVersion)
		if err == nil {
			return Conn{Account: acct, Broker: b, Session: broker.Session{
				ClientID: acct.ClientID, Token: string(token), ExpiresAt: *secret.SessionExpiresAt,
			}}, nil
		}
		m.log.Warn("stored session unreadable; logging in again", "account_id", accountID, "err", err)
	}

	creds, err := m.credentials(acct, b, secret)
	if err != nil {
		return Conn{}, err
	}
	s, err := b.Login(ctx, acct.ClientID, creds)
	if errors.Is(err, broker.ErrInvalidCredentials) {
		if markErr := m.q.MarkAccountNeedsRelink(ctx, accountID); markErr != nil {
			return Conn{}, fmt.Errorf("mark needs relink: %w", markErr)
		}
		return Conn{}, ErrNeedsRelink
	}
	if err != nil {
		return Conn{}, fmt.Errorf("broker login: %w", err)
	}

	if err := m.save(ctx, accountID, s); err != nil {
		m.log.Warn("could not store session; next job logs in again", "account_id", accountID, "err", err)
	}
	return Conn{Account: acct, Broker: b, Session: s}, nil
}

// credentials decides whether the engine may log in on its own, and with what.
func (m *Manager) credentials(acct Account, b broker.Broker, secret db.GetBrokerSecretRow) (broker.Credentials, error) {
	pl, ok := b.(broker.Passwordless)
	passwordless := ok && pl.Passwordless()
	switch {
	case passwordless:
		return broker.Credentials{}, nil
	case acct.LoginMethod != "stored_credentials":
		return broker.Credentials{}, ErrNoSession
	case m.vault == nil || secret.Credentials == nil:
		return broker.Credentials{}, ErrNeedsRelink
	}

	plain, err := m.vault.Open(secret.Credentials, secret.KeyVersion)
	if err != nil {
		return broker.Credentials{}, fmt.Errorf("%w: %w", ErrNeedsRelink, err)
	}
	var creds broker.Credentials
	if err := json.Unmarshal(plain, &creds); err != nil {
		return broker.Credentials{}, fmt.Errorf("%w: credentials are not JSON", ErrNeedsRelink)
	}
	return creds, nil
}

func (m *Manager) save(ctx context.Context, accountID uuid.UUID, s broker.Session) error {
	if m.vault == nil {
		return nil // nothing to seal with; the fake logs in per job
	}
	sealed, err := m.vault.Seal([]byte(s.Token))
	if err != nil {
		return err
	}
	expires := s.ExpiresAt
	return m.q.SaveSession(ctx, db.SaveSessionParams{
		BrokerAccountID:  accountID,
		SessionToken:     sealed,
		SessionExpiresAt: &expires,
		KeyVersion:       m.vault.Version(),
	})
}
