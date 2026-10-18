-- name: GetBrokerAccount :one
SELECT id, user_id, broker, broker_client_id, login_method, status
FROM broker_accounts
WHERE id = @id;

-- name: GetBrokerSecret :one
SELECT credentials, session_token, session_expires_at, key_version
FROM broker_secrets
WHERE broker_account_id = @broker_account_id;

-- name: SaveSession :exec
-- The token is sealed to the engine's own key, like the credentials.
INSERT INTO broker_secrets (broker_account_id, session_token, session_expires_at, key_version)
VALUES (@broker_account_id, @session_token, @session_expires_at, @key_version)
ON CONFLICT (broker_account_id) DO UPDATE
SET session_token = EXCLUDED.session_token,
    session_expires_at = EXCLUDED.session_expires_at,
    updated_at = now();

-- name: ClearSession :exec
-- The broker ended the session early; the next Connect logs in again.
UPDATE broker_secrets
SET session_token = NULL, session_expires_at = NULL, updated_at = now()
WHERE broker_account_id = @broker_account_id;

-- name: MarkAccountNeedsRelink :exec
UPDATE broker_accounts SET status = 'needs_relink' WHERE id = @id;
