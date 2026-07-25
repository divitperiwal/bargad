import { bigint, boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '#database/bytea';

export const brokerAccounts = pgTable('broker_accounts', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  userId: uuid('user_id').notNull(),
  broker: text().notNull(),
  brokerClientId: text('broker_client_id').notNull(),
  label: text().notNull(),
  loginMethod: text('login_method').default('broker_login').notNull(),
  hidden: boolean().default(false).notNull(),
  status: text().default('active').notNull(),
  holdingsSyncedAt: timestamp('holdings_synced_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const brokerSecrets = pgTable('broker_secrets', {
  brokerAccountId: uuid('broker_account_id').primaryKey().notNull(),
  credentials: bytea('credentials'),
  sessionToken: bytea('session_token'),
  sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true, mode: 'string' }),
  keyVersion: integer('key_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const instruments = pgTable('instruments', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  exchange: text().notNull(),
  tradingSymbol: text('trading_symbol').notNull(),
  isin: text().notNull(),
  name: text().notNull(),
  tickSizePaise: integer('tick_size_paise').notNull(),
  lotSize: integer('lot_size').default(1).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const instrumentBrokerIds = pgTable(
  'instrument_broker_ids',
  {
    instrumentId: uuid('instrument_id').notNull(),
    broker: text().notNull(),
    brokerInstrumentId: text('broker_instrument_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.broker, table.instrumentId], name: 'instrument_broker_ids_pkey' })],
);

export const holdings = pgTable(
  'holdings',
  {
    brokerAccountId: uuid('broker_account_id').notNull(),
    instrumentId: uuid('instrument_id').notNull(),
    quantity: bigint({ mode: 'number' }).notNull(),
    avgCostPaise: bigint('avg_cost_paise', { mode: 'number' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.brokerAccountId, table.instrumentId], name: 'holdings_pkey' })],
);

export const tradingHolidays = pgTable(
  'trading_holidays',
  {
    exchange: text().notNull(),
    day: date().notNull(),
    description: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.exchange], name: 'trading_holidays_pkey' })],
);

export const jobs = pgTable('jobs', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  kind: text().notNull(),
  payload: jsonb().default({}).notNull(),
  lane: text(),
  dedupeKey: text('dedupe_key'),
  status: text().default('queued').notNull(),
  attempts: integer().default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  runAt: timestamp('run_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  lockedBy: text('locked_by'),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
  lastError: text('last_error'),
  traceparent: text(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
});
