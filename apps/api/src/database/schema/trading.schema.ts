import { sql } from 'drizzle-orm';
import { bigint, boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const grants = pgTable('grants', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  familyId: uuid('family_id').notNull(),
  grantorUserId: uuid('grantor_user_id').notNull(),
  granteeUserId: uuid('grantee_user_id').notNull(),
  brokerAccountId: uuid('broker_account_id'),
  allowedInstrumentIds: uuid('allowed_instrument_ids').array(),
  startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  buyCapPaise: bigint('buy_cap_paise', { mode: 'number' }).notNull(),
  sellCapPaise: bigint('sell_cap_paise', { mode: 'number' }).notNull(),
  perOrderCapPaise: bigint('per_order_cap_paise', { mode: 'number' }).notNull(),
  buySpentPaise: bigint('buy_spent_paise', { mode: 'number' }).default(0).notNull(),
  sellSpentPaise: bigint('sell_spent_paise', { mode: 'number' }).default(0).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  revokedBy: uuid('revoked_by'),
  revokeReason: text('revoke_reason'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const baskets = pgTable('baskets', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  familyId: uuid('family_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  mode: text().notNull(),
  grantId: uuid('grant_id'),
  bandBps: integer('band_bps').default(100).notNull(),
  status: text().default('proposed').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
  approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true, mode: 'string' }),
  approvedPasskeyId: uuid('approved_passkey_id'),
  tradingDay: date('trading_day').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const basketItems = pgTable('basket_items', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  basketId: uuid('basket_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  brokerAccountId: uuid('broker_account_id').notNull(),
  instrumentId: uuid('instrument_id').notNull(),
  side: text().notNull(),
  quantity: bigint({ mode: 'number' }).notNull(),
  refPricePaise: bigint('ref_price_paise', { mode: 'number' }),
});

export const orders = pgTable('orders', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  basketItemId: uuid('basket_item_id').notNull(),
  brokerAccountId: uuid('broker_account_id').notNull(),
  side: text().notNull(),
  quantity: bigint({ mode: 'number' }).notNull(),
  refPricePaise: bigint('ref_price_paise', { mode: 'number' }).notNull(),
  bandBps: integer('band_bps').notNull(),
  limitPricePaise: bigint('limit_price_paise', { mode: 'number' }).notNull(),
  notionalPaise: bigint('notional_paise', { mode: 'number' }).generatedAlwaysAs(sql`(quantity * limit_price_paise)`),
  orderType: text('order_type').default('LIMIT').notNull(),
  product: text().default('CNC').notNull(),
  status: text().default('claimed').notNull(),
  brokerOrderId: text('broker_order_id'),
  filledQty: bigint('filled_qty', { mode: 'number' }).default(0).notNull(),
  avgFillPaise: bigint('avg_fill_paise', { mode: 'number' }),
  rejectReason: text('reject_reason'),
  tradingDay: date('trading_day').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const killSwitches = pgTable(
  'kill_switches',
  {
    scope: text().notNull(),
    scopeKey: text('scope_key').notNull(),
    engaged: boolean().default(true).notNull(),
    reason: text().notNull(),
    changedBy: uuid('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.scopeKey], name: 'kill_switches_pkey' })],
);
