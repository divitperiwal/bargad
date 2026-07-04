-- +goose Up

-- Spend is added before the broker call and never refunded.
CREATE TABLE grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families,
  grantor_user_id uuid NOT NULL REFERENCES users,
  grantee_user_id uuid NOT NULL REFERENCES users,
  broker_account_id uuid,
  allowed_instrument_ids uuid[],
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  buy_cap_paise bigint NOT NULL CHECK (buy_cap_paise >= 0),
  sell_cap_paise bigint NOT NULL CHECK (sell_cap_paise >= 0),
  per_order_cap_paise bigint NOT NULL CHECK (per_order_cap_paise > 0),
  buy_spent_paise bigint NOT NULL DEFAULT 0,
  sell_spent_paise bigint NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users,
  revoke_reason text CHECK (revoke_reason IN ('member', 'admin', 'left', 'removed', 'handover')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (broker_account_id, grantor_user_id) REFERENCES broker_accounts (id, user_id),
  CONSTRAINT grants_duration CHECK (expires_at - starts_at BETWEEN interval '1 hour' AND interval '7 days'),
  CONSTRAINT grants_buy_within_cap CHECK (buy_spent_paise BETWEEN 0 AND buy_cap_paise),
  CONSTRAINT grants_sell_within_cap CHECK (sell_spent_paise BETWEEN 0 AND sell_cap_paise),
  CHECK (grantor_user_id <> grantee_user_id),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX grants_active ON grants (grantor_user_id) WHERE revoked_at IS NULL;

-- The approved_* columns hold the live approval; earlier ones are in audit_log.
CREATE TABLE baskets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families,
  owner_user_id uuid NOT NULL REFERENCES users,
  created_by uuid NOT NULL REFERENCES users,
  mode text NOT NULL CHECK (mode IN ('self', 'approval', 'grant')),
  grant_id uuid REFERENCES grants,
  band_bps int NOT NULL DEFAULT 100 CHECK (band_bps BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'queued', 'executing', 'done', 'rejected', 'cancelled', 'expired')),
  approved_at timestamptz,
  approval_expires_at timestamptz,
  approved_passkey_id uuid,
  trading_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_user_id),
  FOREIGN KEY (approved_passkey_id, owner_user_id) REFERENCES passkeys (id, user_id)
    ON DELETE SET NULL (approved_passkey_id),
  CHECK ((mode = 'grant') = (grant_id IS NOT NULL)),
  CHECK ((mode = 'self') = (created_by = owner_user_id)),
  CHECK (approved_at IS NULL OR mode = 'approval'),
  CHECK ((approved_at IS NULL) = (approval_expires_at IS NULL))
);
CREATE INDEX baskets_owner ON baskets (owner_user_id, status);
CREATE INDEX baskets_family ON baskets (family_id, created_at DESC);
CREATE INDEX baskets_grant ON baskets (grant_id) WHERE grant_id IS NOT NULL;

CREATE TABLE basket_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  basket_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  broker_account_id uuid NOT NULL,
  instrument_id uuid NOT NULL REFERENCES instruments,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity bigint NOT NULL CHECK (quantity > 0),
  ref_price_paise bigint CHECK (ref_price_paise > 0), -- what the member saw when approving
  FOREIGN KEY (basket_id, owner_user_id) REFERENCES baskets (id, owner_user_id),
  FOREIGN KEY (broker_account_id, owner_user_id) REFERENCES broker_accounts (id, user_id),
  UNIQUE (id, broker_account_id, side)
);
CREATE INDEX basket_items_basket ON basket_items (basket_id);

-- id doubles as the idempotency key: the row exists before the broker is called.
-- ref_price_paise is the approved price, or the engine's quote for grant and self orders.
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  basket_item_id uuid NOT NULL,
  broker_account_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity bigint NOT NULL CHECK (quantity > 0),
  ref_price_paise bigint NOT NULL CHECK (ref_price_paise > 0),
  band_bps int NOT NULL,
  limit_price_paise bigint NOT NULL,
  notional_paise bigint GENERATED ALWAYS AS (quantity * limit_price_paise) STORED,
  order_type text NOT NULL DEFAULT 'LIMIT' CHECK (order_type = 'LIMIT'),
  product text NOT NULL DEFAULT 'CNC' CHECK (product = 'CNC'),
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'unknown', 'open', 'partial', 'filled', 'cancelled', 'rejected')),
  broker_order_id text,
  filled_qty bigint NOT NULL DEFAULT 0,
  avg_fill_paise bigint,
  reject_reason text,
  trading_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (basket_item_id, broker_account_id, side) REFERENCES basket_items (id, broker_account_id, side),
  UNIQUE (broker_account_id, broker_order_id),
  CHECK (filled_qty BETWEEN 0 AND quantity),
  CONSTRAINT orders_within_band CHECK (
    limit_price_paise * 10000 BETWEEN ref_price_paise * (10000 - band_bps)
                                  AND ref_price_paise * (10000 + band_bps)
  )
);
CREATE INDEX orders_item ON orders (basket_item_id);
CREATE INDEX orders_unresolved ON orders (status)
  WHERE status IN ('claimed', 'sent', 'unknown', 'open', 'partial');
CREATE INDEX orders_account_day ON orders (broker_account_id, trading_day);
CREATE TRIGGER orders_notify AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_change();

-- scope_key is '' for global, a family id, or a broker name.
CREATE TABLE kill_switches (
  scope text NOT NULL CHECK (scope IN ('global', 'family', 'broker')),
  scope_key text NOT NULL,
  engaged boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  changed_by uuid REFERENCES users,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_key),
  CHECK (scope <> 'global' OR scope_key = '')
);

-- +goose Down
DROP TABLE kill_switches;
DROP TABLE orders;
DROP TABLE basket_items;
DROP TABLE baskets;
DROP TABLE grants;
