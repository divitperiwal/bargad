-- +goose Up
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  monthly_income_paise bigint CHECK (monthly_income_paise >= 0),
  monthly_expenses_paise bigint CHECK (monthly_expenses_paise >= 0),
  feed_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email ON users (email) WHERE deleted_at IS NULL;

CREATE TABLE passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (id, user_id)
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- Synced passkeys always report sign_count 0, so used_at is what stops a replay.
CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('register', 'login', 'approve', 'credentials')),
  target_id uuid,
  challenge bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (purpose NOT IN ('approve', 'credentials') OR target_id IS NOT NULL)
);
CREATE INDEX auth_challenges_expiry ON auth_challenges (expires_at);

CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  client text NOT NULL CHECK (client IN ('web', 'app')),
  push_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (client = 'app' OR push_token IS NULL)
);
CREATE INDEX sessions_user ON sessions (user_id);

-- +goose Down
DROP TABLE sessions;
DROP TABLE auth_challenges;
DROP TABLE passkeys;
DROP TABLE users;
