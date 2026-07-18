import { bigint, boolean, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '#database/bytea';

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  email: text().notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  monthlyIncomePaise: bigint('monthly_income_paise', { mode: 'number' }),
  monthlyExpensesPaise: bigint('monthly_expenses_paise', { mode: 'number' }),
  feedSeenAt: timestamp('feed_seen_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  mobile: text(),
  dateOfBirth: date('date_of_birth'),
});

export const passkeys = pgTable('passkeys', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  userId: uuid('user_id').notNull(),
  credentialId: bytea('credential_id').notNull(),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).default(0).notNull(),
  transports: text().array().default([]).notNull(),
  name: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
});

export const authChallenges = pgTable('auth_challenges', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  userId: uuid('user_id'),
  purpose: text().notNull(),
  targetId: uuid('target_id'),
  challenge: bytea('challenge').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
});

export const sessions = pgTable('sessions', {
  tokenHash: bytea('token_hash').primaryKey().notNull(),
  userId: uuid('user_id').notNull(),
  client: text().notNull(),
  pushToken: text('push_token'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
});
