-- +goose Up
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users,
  kind text NOT NULL CHECK (kind IN ('asset', 'liability')),
  type text NOT NULL,
  name text NOT NULL,
  value_paise bigint NOT NULL CHECK (value_paise >= 0),
  as_of date NOT NULL,
  emi_paise bigint CHECK (emi_paise >= 0),
  interest_rate_bps int CHECK (interest_rate_bps >= 0),
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (
    (kind = 'asset'
      AND type IN ('bank_cash', 'fd', 'epf_ppf_nps', 'gold', 'real_estate', 'vehicle', 'other')
      AND emi_paise IS NULL AND interest_rate_bps IS NULL)
    OR (kind = 'liability'
      AND type IN ('home_loan', 'car_loan', 'personal_loan', 'education_loan', 'credit_card'))
  )
);
CREATE INDEX ledger_entries_user ON ledger_entries (user_id) WHERE deleted_at IS NULL;

-- Brokers can't give this history back later, so it's recorded from day one.
CREATE TABLE daily_valuations (
  broker_account_id uuid NOT NULL REFERENCES broker_accounts ON DELETE CASCADE,
  day date NOT NULL,
  market_value_paise bigint NOT NULL,
  invested_paise bigint NOT NULL,
  PRIMARY KEY (broker_account_id, day)
);

-- +goose Down
DROP TABLE daily_valuations;
DROP TABLE ledger_entries;
