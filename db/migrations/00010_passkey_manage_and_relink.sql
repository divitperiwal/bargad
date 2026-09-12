-- +goose Up
-- Adding or removing a passkey, once the user has one, needs a step-up bound to their own user id.
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_purpose_check;
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check
    CHECK (purpose IN ('register', 'login', 'approve', 'credentials', 'grant', 'password_reset', 'passkey_manage')),
  ADD CONSTRAINT auth_challenges_check
    CHECK (purpose NOT IN ('approve', 'credentials', 'grant', 'passkey_manage') OR target_id IS NOT NULL);

-- A closed account (its owner deleted their Bargad account) no longer holds its broker client id,
-- so a returning user can link it again.
ALTER TABLE broker_accounts DROP CONSTRAINT broker_accounts_broker_broker_client_id_key;
CREATE UNIQUE INDEX broker_accounts_client ON broker_accounts (broker, broker_client_id) WHERE status <> 'closed';

-- +goose Down
-- Fails if a client id was relinked after being closed; resolve those rows by hand first.
DROP INDEX broker_accounts_client;
ALTER TABLE broker_accounts
  ADD CONSTRAINT broker_accounts_broker_broker_client_id_key UNIQUE (broker, broker_client_id);

DELETE FROM auth_challenges WHERE purpose = 'passkey_manage';
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_purpose_check;
ALTER TABLE auth_challenges DROP CONSTRAINT auth_challenges_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check
    CHECK (purpose IN ('register', 'login', 'approve', 'credentials', 'grant', 'password_reset')),
  ADD CONSTRAINT auth_challenges_check
    CHECK (purpose NOT IN ('approve', 'credentials', 'grant') OR target_id IS NOT NULL);
