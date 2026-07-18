import { bigint, boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  userId: uuid('user_id').notNull(),
  kind: text().notNull(),
  type: text().notNull(),
  name: text().notNull(),
  valuePaise: bigint('value_paise', { mode: 'number' }).notNull(),
  asOf: date('as_of').notNull(),
  emiPaise: bigint('emi_paise', { mode: 'number' }),
  interestRateBps: integer('interest_rate_bps'),
  hidden: boolean().default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

export const dailyValuations = pgTable(
  'daily_valuations',
  {
    brokerAccountId: uuid('broker_account_id').notNull(),
    day: date().notNull(),
    marketValuePaise: bigint('market_value_paise', { mode: 'number' }).notNull(),
    investedPaise: bigint('invested_paise', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.brokerAccountId, table.day], name: 'daily_valuations_pkey' })],
);
