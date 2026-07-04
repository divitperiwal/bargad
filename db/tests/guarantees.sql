-- Checks that the schema itself refuses what the design forbids.
-- Everything runs in one transaction and is rolled back.
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

CREATE FUNCTION pg_temp.must_fail(stmt text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'expected "%" but got "%" from: %', expected, SQLERRM, stmt;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected "%" but it succeeded: %', expected, stmt;
END $$;

-- ...01 head, ...02 mum, ...03 sister; f1 family; a1/a2 head's and mum's accounts;
-- aa/bb their passkeys; e1 instrument; c1 mum's grant; b1/d1 mum's basket and its item.
INSERT INTO users (id, email, password_hash, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'head@test', 'x', 'Head'),
  ('00000000-0000-0000-0000-000000000002', 'mum@test', 'x', 'Mum'),
  ('00000000-0000-0000-0000-000000000003', 'sister@test', 'x', 'Sister');
INSERT INTO passkeys (id, user_id, credential_id, public_key, name) VALUES
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', '\x01', '\x01', 'head'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-000000000002', '\x02', '\x02', 'mum');
INSERT INTO families (id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Test');
INSERT INTO family_members (family_id, user_id, role, relationship) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'head', 'self'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', 'member', 'dependent_parent'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000003', 'member', NULL);
INSERT INTO broker_accounts (id, user_id, broker, broker_client_id, label) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'fake', 'test-head', 'Head'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', 'fake', 'test-mum', 'Mum');
INSERT INTO instruments (id, exchange, trading_symbol, isin, name, tick_size_paise) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'NSE', 'TEST', 'INE000T00001', 'Test Ltd', 5);
INSERT INTO grants (id, family_id, grantor_user_id, grantee_user_id, expires_at, buy_cap_paise, sell_cap_paise, per_order_cap_paise) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', now() + interval '1 day', 100000, 50000, 20000);
INSERT INTO baskets (id, family_id, owner_user_id, created_by, mode, trading_day) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'approval', current_date);
INSERT INTO basket_items (id, basket_id, owner_user_id, broker_account_id, instrument_id, side, quantity, ref_price_paise) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'buy', 1, 150000);
UPDATE baskets
SET status = 'queued', approved_at = now(), approval_expires_at = now() + interval '6 hours',
    approved_passkey_id = '00000000-0000-0000-0000-0000000000bb'
WHERE id = '00000000-0000-0000-0000-0000000000b1';
INSERT INTO audit_log (subject_user_id, action) VALUES ('00000000-0000-0000-0000-000000000002', 'basket.approved');

-- Money
SELECT pg_temp.must_fail($$INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps, limit_price_paise, order_type, trading_day)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'buy', 1, 150000, 100, 150000, 'MARKET', current_date)$$,
  'orders_order_type_check');
SELECT pg_temp.must_fail($$INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps, limit_price_paise, product, trading_day)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'buy', 1, 150000, 100, 150000, 'MIS', current_date)$$,
  'orders_product_check');
SELECT pg_temp.must_fail($$INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps, limit_price_paise, trading_day)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'buy', 1, 150000, 100, 151515, current_date)$$,
  'orders_within_band');
SELECT pg_temp.must_fail($$INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps, limit_price_paise, trading_day)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'buy', 1, 150000, 100, 150000, current_date)$$,
  'orders_basket_item_id_broker_account_id_side_fkey');
SELECT pg_temp.must_fail($$INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps, limit_price_paise, trading_day)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'sell', 1, 150000, 100, 150000, current_date)$$,
  'orders_basket_item_id_broker_account_id_side_fkey');
SELECT pg_temp.must_fail($$UPDATE grants SET buy_spent_paise = 100001$$, 'grants_buy_within_cap');
SELECT pg_temp.must_fail($$UPDATE grants SET sell_spent_paise = 50001$$, 'grants_sell_within_cap');
SELECT pg_temp.must_fail($$UPDATE grants SET expires_at = starts_at + interval '8 days'$$, 'grants_duration');
SELECT pg_temp.must_fail($$INSERT INTO grants (family_id, grantor_user_id, grantee_user_id, broker_account_id, expires_at, buy_cap_paise, sell_cap_paise, per_order_cap_paise)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', now() + interval '2 hours', 1, 1, 1)$$,
  'grants_broker_account_id_grantor_user_id_fkey');
SELECT pg_temp.must_fail($$INSERT INTO basket_items (basket_id, owner_user_id, broker_account_id, instrument_id, side, quantity)
  VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000e1', 'buy', 1)$$,
  'basket_items_broker_account_id_owner_user_id_fkey');
SELECT pg_temp.must_fail($$UPDATE baskets SET approved_passkey_id = '00000000-0000-0000-0000-0000000000aa'$$,
  'baskets_approved_passkey_id_owner_user_id_fkey');
SELECT pg_temp.must_fail($$INSERT INTO baskets (family_id, owner_user_id, created_by, mode, trading_day)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'self', current_date)$$,
  'baskets_check1');
SELECT pg_temp.must_fail($$INSERT INTO baskets (family_id, owner_user_id, created_by, mode, trading_day, approved_at, approval_expires_at)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'self', current_date, now(), now())$$,
  'baskets_check2');
SELECT pg_temp.must_fail($$INSERT INTO jobs (kind, lane, status, locked_until) VALUES ('execute', 'a2', 'running', now()), ('execute', 'a2', 'running', now())$$,
  'jobs_one_running_per_lane');

-- Family
SELECT pg_temp.must_fail($$UPDATE family_members SET role = 'head', relationship = 'self' WHERE user_id = '00000000-0000-0000-0000-000000000002'$$,
  'family_members_one_head');
SELECT pg_temp.must_fail($$INSERT INTO family_members (family_id, user_id, role, relationship)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000002', 'member', 'spouse')$$,
  'family_members_one_family');
SELECT pg_temp.must_fail($$INSERT INTO invites (family_id, invited_by, email, relationship, token_hash, expires_at)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'new@test', 'spouse', '\x01', now() + interval '8 days')$$,
  'invites_check');
SELECT pg_temp.must_fail($$INSERT INTO sessions (token_hash, user_id, client, push_token, expires_at)
  VALUES ('\x01', '00000000-0000-0000-0000-000000000001', 'web', 'ExponentPushToken[x]', now())$$,
  'sessions_check');

-- Audit log
SELECT pg_temp.must_fail($$UPDATE audit_log SET action = 'x'$$, 'append-only');
SELECT pg_temp.must_fail($$DELETE FROM audit_log$$, 'append-only');
SELECT pg_temp.must_fail($$TRUNCATE audit_log$$, 'append-only');

-- API role
SET ROLE bargad_api;
INSERT INTO broker_secrets (broker_account_id, credentials, key_version)
VALUES ('00000000-0000-0000-0000-0000000000a2', '\xdead', 1);
SELECT pg_temp.must_fail($$SELECT credentials FROM broker_secrets$$, 'permission denied');
SELECT pg_temp.must_fail($$SELECT session_token FROM broker_secrets$$, 'permission denied');
SELECT pg_temp.must_fail($$UPDATE orders SET status = 'filled'$$, 'permission denied');
SELECT pg_temp.must_fail($$UPDATE grants SET buy_spent_paise = 0$$, 'permission denied');
UPDATE broker_secrets SET credentials = NULL WHERE broker_account_id = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO jobs (kind) VALUES ('push');
INSERT INTO audit_log (subject_user_id, action) VALUES ('00000000-0000-0000-0000-000000000002', 'credentials.revoked');
RESET ROLE;

-- Engine role
SET ROLE bargad_engine;
SELECT pg_temp.must_fail($$SELECT password_hash FROM users$$, 'permission denied');
SELECT pg_temp.must_fail($$SELECT token_hash FROM sessions$$, 'permission denied');
SELECT pg_temp.must_fail($$UPDATE grants SET revoked_at = now()$$, 'permission denied');
UPDATE broker_secrets SET session_token = '\xbeef', session_expires_at = now() + interval '8 hours';
SELECT session_token FROM broker_secrets;
SELECT status FROM baskets WHERE id = '00000000-0000-0000-0000-0000000000b1' FOR UPDATE;
UPDATE grants SET buy_spent_paise = buy_spent_paise + 1515 WHERE id = '00000000-0000-0000-0000-0000000000c1';
INSERT INTO orders (basket_item_id, broker_account_id, side, quantity, ref_price_paise, band_bps, limit_price_paise, trading_day)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2', 'buy', 1, 150000, 100, 151500, current_date);
INSERT INTO audit_log (subject_user_id, action) VALUES ('00000000-0000-0000-0000-000000000002', 'order.placed');
RESET ROLE;

ROLLBACK;
\echo schema guarantees: ok
