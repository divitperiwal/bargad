-- +goose Up

-- Group roles. Each environment adds its own LOGIN roles to them.
-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bargad_api') THEN
    CREATE ROLE bargad_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bargad_engine') THEN
    CREATE ROLE bargad_engine NOLOGIN;
  END IF;
END
$$;
-- +goose StatementEnd

GRANT USAGE ON SCHEMA public TO bargad_api, bargad_engine;

GRANT SELECT, INSERT, UPDATE, DELETE ON passkeys, auth_challenges, sessions TO bargad_api;
GRANT SELECT, INSERT, UPDATE ON
  users, families, family_members, invites, ledger_entries, basket_items, kill_switches
  TO bargad_api;
GRANT SELECT, INSERT ON audit_log, jobs, broker_accounts, baskets, grants TO bargad_api;
GRANT SELECT ON
  instruments, instrument_broker_ids, holdings, trading_holidays, daily_valuations, orders
  TO bargad_api;
GRANT UPDATE (label, login_method, hidden, status) ON broker_accounts TO bargad_api;
GRANT UPDATE (status, approved_at, approval_expires_at, approved_passkey_id, updated_at) ON baskets TO bargad_api;
GRANT UPDATE (revoked_at, revoked_by, revoke_reason) ON grants TO bargad_api;
-- The API seals and wipes credentials but can never read them back.
GRANT SELECT (broker_account_id, session_expires_at, key_version, updated_at) ON broker_secrets TO bargad_api;
GRANT INSERT ON broker_secrets TO bargad_api;
GRANT UPDATE (credentials, key_version, updated_at) ON broker_secrets TO bargad_api;

GRANT SELECT (id, display_name, deleted_at) ON users TO bargad_engine;
GRANT SELECT ON families, family_members, basket_items, kill_switches TO bargad_engine;
GRANT SELECT, INSERT, UPDATE ON broker_secrets, daily_valuations, orders TO bargad_engine;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  instruments, instrument_broker_ids, holdings, trading_holidays, jobs
  TO bargad_engine;
GRANT INSERT ON audit_log TO bargad_engine;
GRANT SELECT ON broker_accounts, baskets, grants TO bargad_engine;
GRANT UPDATE (status, holdings_synced_at) ON broker_accounts TO bargad_engine;
GRANT UPDATE (status, approved_at, approval_expires_at, updated_at) ON baskets TO bargad_engine;
GRANT UPDATE (buy_spent_paise, sell_spent_paise) ON grants TO bargad_engine;

-- +goose Down
DROP OWNED BY bargad_api, bargad_engine;
DROP ROLE bargad_api;
DROP ROLE bargad_engine;
