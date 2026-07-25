import { sql } from 'drizzle-orm';
import { bigint, boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from '#database/bytea';

export const families = pgTable('families', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  name: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  dissolvedAt: timestamp('dissolved_at', { withTimezone: true, mode: 'string' }),
});

export const familyMembers = pgTable('family_members', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  familyId: uuid('family_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text().notNull(),
  relationship: text(),
  canTrade: boolean('can_trade').generatedAlwaysAs(sql`COALESCE((relationship <> 'other'::text), false)`),
  joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  leftAt: timestamp('left_at', { withTimezone: true, mode: 'string' }),
  leftReason: text('left_reason'),
});

export const invites = pgTable('invites', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  familyId: uuid('family_id').notNull(),
  invitedBy: uuid('invited_by').notNull(),
  email: text().notNull(),
  relationship: text().notNull(),
  tokenHash: bytea('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' })
    .default(sql`(now() + '7 days'::interval)`)
    .notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
  acceptedBy: uuid('accepted_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    familyId: uuid('family_id'),
    actorUserId: uuid('actor_user_id'),
    subjectUserId: uuid('subject_user_id').notNull(),
    action: text().notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    detail: jsonb().default({}).notNull(),
    traceId: text('trace_id'),
  },
  (table) => [primaryKey({ columns: [table.at, table.id], name: 'audit_log_pkey' })],
);
