-- +goose Up
CREATE TABLE broker_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users,
  broker text NOT NULL CHECK (broker IN ('dhan', 'mstock', 'fake')),
  broker_client_id text NOT NULL,
  label text NOT NULL,
  login_method text NOT NULL DEFAULT 'broker_login' CHECK (login_method IN ('broker_login', 'stored_credentials')),
  hidden boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_relink', 'closed')),
  holdings_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broker, broker_client_id),
  UNIQUE (id, user_id)
);
CREATE INDEX broker_accounts_user ON broker_accounts (user_id);

-- Both blobs are sealed to the engine's public key.
CREATE TABLE broker_secrets (
  broker_account_id uuid PRIMARY KEY REFERENCES broker_accounts ON DELETE CASCADE,
  credentials bytea,
  session_token bytea,
  session_expires_at timestamptz,
  key_version int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((session_token IS NULL) = (session_expires_at IS NULL))
);

CREATE TABLE instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange text NOT NULL CHECK (exchange IN ('NSE', 'BSE')),
  trading_symbol text NOT NULL,
  isin text NOT NULL CHECK (char_length(isin) = 12),
  name text NOT NULL,
  tick_size_paise int NOT NULL CHECK (tick_size_paise > 0),
  lot_size int NOT NULL DEFAULT 1 CHECK (lot_size > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange, trading_symbol)
);
CREATE INDEX instruments_isin ON instruments (isin);
CREATE INDEX instruments_symbol_prefix ON instruments (trading_symbol text_pattern_ops);

CREATE TABLE instrument_broker_ids (
  instrument_id uuid NOT NULL REFERENCES instruments ON DELETE CASCADE,
  broker text NOT NULL CHECK (broker IN ('dhan', 'mstock', 'fake')),
  broker_instrument_id text NOT NULL,
  PRIMARY KEY (instrument_id, broker),
  UNIQUE (broker, broker_instrument_id)
);

CREATE TABLE holdings (
  broker_account_id uuid NOT NULL REFERENCES broker_accounts ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES instruments,
  quantity bigint NOT NULL CHECK (quantity >= 0),
  avg_cost_paise bigint NOT NULL CHECK (avg_cost_paise >= 0),
  synced_at timestamptz NOT NULL,
  PRIMARY KEY (broker_account_id, instrument_id)
);

CREATE TABLE trading_holidays (
  exchange text NOT NULL CHECK (exchange IN ('NSE', 'BSE')),
  day date NOT NULL,
  description text NOT NULL,
  PRIMARY KEY (exchange, day)
);

CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  lane text,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  last_error text,
  traceparent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((status = 'running') = (locked_until IS NOT NULL))
);
CREATE INDEX jobs_ready ON jobs (run_at) WHERE status = 'queued';
CREATE INDEX jobs_leased ON jobs (locked_until) WHERE status = 'running';
-- lane is a broker account; one running job each, so two jobs can't spend the same cash.
CREATE UNIQUE INDEX jobs_one_running_per_lane ON jobs (lane) WHERE status = 'running';
CREATE TRIGGER jobs_notify AFTER INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION notify_change();

-- +goose Down
DROP TABLE jobs;
DROP TABLE trading_holidays;
DROP TABLE holdings;
DROP TABLE instrument_broker_ids;
DROP TABLE instruments;
DROP TABLE broker_secrets;
DROP TABLE broker_accounts;
