-- Development data: one family on the fake broker. Every user's password is bargad-dev.
-- Safe to run again; rows that already exist are skipped.
BEGIN;

INSERT INTO users (id, email, password_hash, display_name, monthly_income_paise, monthly_expenses_paise) VALUES
  ('5eed0000-0000-0000-0000-000000000001', 'rohan@bargad.test', '$argon2id$v=19$m=65536,t=2,p=1$D7L+tjLTT3PaUo24uTHO5rRQAO3zXW0CIMHnfhiktVA$+IE8BQRvFNguUbuk9BOIDf9mrDaXz+VhkhsVcyeKJDw', 'Rohan Mehta', 25000000, 12000000),
  ('5eed0000-0000-0000-0000-000000000002', 'priya@bargad.test', '$argon2id$v=19$m=65536,t=2,p=1$D7L+tjLTT3PaUo24uTHO5rRQAO3zXW0CIMHnfhiktVA$+IE8BQRvFNguUbuk9BOIDf9mrDaXz+VhkhsVcyeKJDw', 'Priya Mehta', 18000000, NULL),
  ('5eed0000-0000-0000-0000-000000000003', 'kabir@bargad.test', '$argon2id$v=19$m=65536,t=2,p=1$D7L+tjLTT3PaUo24uTHO5rRQAO3zXW0CIMHnfhiktVA$+IE8BQRvFNguUbuk9BOIDf9mrDaXz+VhkhsVcyeKJDw', 'Kabir Mehta', NULL, NULL),
  ('5eed0000-0000-0000-0000-000000000004', 'anil@bargad.test',  '$argon2id$v=19$m=65536,t=2,p=1$D7L+tjLTT3PaUo24uTHO5rRQAO3zXW0CIMHnfhiktVA$+IE8BQRvFNguUbuk9BOIDf9mrDaXz+VhkhsVcyeKJDw', 'Anil Mehta', NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO families (id, name) VALUES
  ('5eed0000-0000-0000-0000-0000000000f1', 'Mehta family')
ON CONFLICT DO NOTHING;

-- Anil is a brother ('other'), so the head can see his account but never trade in it.
INSERT INTO family_members (family_id, user_id, role, relationship) VALUES
  ('5eed0000-0000-0000-0000-0000000000f1', '5eed0000-0000-0000-0000-000000000001', 'head',   'self'),
  ('5eed0000-0000-0000-0000-0000000000f1', '5eed0000-0000-0000-0000-000000000002', 'member', 'spouse'),
  ('5eed0000-0000-0000-0000-0000000000f1', '5eed0000-0000-0000-0000-000000000003', 'member', 'dependent_child'),
  ('5eed0000-0000-0000-0000-0000000000f1', '5eed0000-0000-0000-0000-000000000004', 'member', 'other')
ON CONFLICT DO NOTHING;

INSERT INTO broker_accounts (id, user_id, broker, broker_client_id, label, holdings_synced_at) VALUES
  ('5eed0000-0000-0000-0000-0000000000a1', '5eed0000-0000-0000-0000-000000000001', 'fake', 'FAKE-ROHAN', 'Rohan · Fake', now()),
  ('5eed0000-0000-0000-0000-0000000000a2', '5eed0000-0000-0000-0000-000000000002', 'fake', 'FAKE-PRIYA', 'Priya · Fake', now()),
  ('5eed0000-0000-0000-0000-0000000000a4', '5eed0000-0000-0000-0000-000000000004', 'fake', 'FAKE-ANIL',  'Anil · Fake',  now())
ON CONFLICT DO NOTHING;

INSERT INTO instruments (id, exchange, trading_symbol, isin, name, tick_size_paise) VALUES
  ('5eed0000-0000-0000-0000-0000000000e1', 'NSE', 'NIFTYBEES', 'INF204KB14I2', 'Nippon India ETF Nifty 50 BeES', 1),
  ('5eed0000-0000-0000-0000-0000000000e2', 'NSE', 'GOLDBEES',  'INF204KB17I5', 'Nippon India ETF Gold BeES',     1),
  ('5eed0000-0000-0000-0000-0000000000e3', 'NSE', 'RELIANCE',  'INE002A01018', 'Reliance Industries',           10),
  ('5eed0000-0000-0000-0000-0000000000e4', 'NSE', 'TCS',       'INE467B01029', 'Tata Consultancy Services',     10),
  ('5eed0000-0000-0000-0000-0000000000e5', 'NSE', 'HDFCBANK',  'INE040A01034', 'HDFC Bank',                      5),
  ('5eed0000-0000-0000-0000-0000000000e6', 'NSE', 'INFY',      'INE009A01021', 'Infosys',                       10)
ON CONFLICT DO NOTHING;

INSERT INTO instrument_broker_ids (instrument_id, broker, broker_instrument_id)
SELECT id, 'fake', trading_symbol FROM instruments
ON CONFLICT DO NOTHING;

INSERT INTO holdings (broker_account_id, instrument_id, quantity, avg_cost_paise, synced_at) VALUES
  ('5eed0000-0000-0000-0000-0000000000a1', '5eed0000-0000-0000-0000-0000000000e1', 400,  26150, now()),
  ('5eed0000-0000-0000-0000-0000000000a1', '5eed0000-0000-0000-0000-0000000000e3',  25, 128040, now()),
  ('5eed0000-0000-0000-0000-0000000000a1', '5eed0000-0000-0000-0000-0000000000e4',  10, 341210, now()),
  ('5eed0000-0000-0000-0000-0000000000a2', '5eed0000-0000-0000-0000-0000000000e2', 300,   7420, now()),
  ('5eed0000-0000-0000-0000-0000000000a2', '5eed0000-0000-0000-0000-0000000000e5',  40,  95580, now()),
  ('5eed0000-0000-0000-0000-0000000000a4', '5eed0000-0000-0000-0000-0000000000e6',  15, 151030, now())
ON CONFLICT DO NOTHING;

INSERT INTO ledger_entries (id, user_id, kind, type, name, value_paise, as_of, emi_paise, interest_rate_bps) VALUES
  ('5eed0000-0000-0000-0000-0000000000c1', '5eed0000-0000-0000-0000-000000000001', 'asset',     'bank_cash', 'Savings account', 42000000,  current_date, NULL,    NULL),
  ('5eed0000-0000-0000-0000-0000000000c2', '5eed0000-0000-0000-0000-000000000001', 'asset',     'fd',        'SBI fixed deposit', 100000000, current_date, NULL,  NULL),
  ('5eed0000-0000-0000-0000-0000000000c3', '5eed0000-0000-0000-0000-000000000001', 'liability', 'home_loan', 'Home loan',      3850000000, current_date, 4120000, 840),
  ('5eed0000-0000-0000-0000-0000000000c4', '5eed0000-0000-0000-0000-000000000002', 'asset',     'gold',      'Jewellery',       60000000,  current_date, NULL,    NULL)
ON CONFLICT DO NOTHING;

-- NSE equity holidays for 2026 that fall on weekdays, from the exchange's circular.
INSERT INTO trading_holidays (exchange, day, description) VALUES
  ('NSE', '2026-01-26', 'Republic Day'),
  ('NSE', '2026-03-03', 'Holi'),
  ('NSE', '2026-03-26', 'Shri Ram Navami'),
  ('NSE', '2026-03-31', 'Shri Mahavir Jayanti'),
  ('NSE', '2026-04-03', 'Good Friday'),
  ('NSE', '2026-04-14', 'Dr. Baba Saheb Ambedkar Jayanti'),
  ('NSE', '2026-05-01', 'Maharashtra Day'),
  ('NSE', '2026-05-28', 'Bakri Id'),
  ('NSE', '2026-06-26', 'Muharram'),
  ('NSE', '2026-09-14', 'Ganesh Chaturthi'),
  ('NSE', '2026-10-02', 'Mahatma Gandhi Jayanti'),
  ('NSE', '2026-10-20', 'Dussehra'),
  ('NSE', '2026-11-10', 'Diwali Balipratipada'),
  ('NSE', '2026-11-24', 'Prakash Gurpurb Sri Guru Nanak Dev'),
  ('NSE', '2026-12-25', 'Christmas')
ON CONFLICT DO NOTHING;

COMMIT;
