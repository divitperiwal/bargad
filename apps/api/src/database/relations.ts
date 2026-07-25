import { relations } from 'drizzle-orm/relations';
import {
  auditLog,
  authChallenges,
  basketItems,
  baskets,
  brokerAccounts,
  brokerSecrets,
  dailyValuations,
  families,
  familyMembers,
  grants,
  holdings,
  instrumentBrokerIds,
  instruments,
  invites,
  killSwitches,
  ledgerEntries,
  orders,
  passkeys,
  sessions,
  users,
} from './schema';

export const passkeysRelations = relations(passkeys, ({ one, many }) => ({
  user: one(users, {
    fields: [passkeys.userId],
    references: [users.id],
  }),
  baskets: many(baskets),
}));

export const usersRelations = relations(users, ({ many }) => ({
  passkeys: many(passkeys),
  authChallenges: many(authChallenges),
  sessions: many(sessions),
  invites_acceptedBy: many(invites, {
    relationName: 'invites_acceptedBy_users_id',
  }),
  invites_invitedBy: many(invites, {
    relationName: 'invites_invitedBy_users_id',
  }),
  brokerAccounts: many(brokerAccounts),
  ledgerEntries: many(ledgerEntries),
  familyMembers: many(familyMembers),
  baskets_createdBy: many(baskets, {
    relationName: 'baskets_createdBy_users_id',
  }),
  baskets_ownerUserId: many(baskets, {
    relationName: 'baskets_ownerUserId_users_id',
  }),
  grants_granteeUserId: many(grants, {
    relationName: 'grants_granteeUserId_users_id',
  }),
  grants_grantorUserId: many(grants, {
    relationName: 'grants_grantorUserId_users_id',
  }),
  grants_revokedBy: many(grants, {
    relationName: 'grants_revokedBy_users_id',
  }),
  killSwitches: many(killSwitches),
  auditLogs_actorUserId: many(auditLog, {
    relationName: 'auditLog_actorUserId_users_id',
  }),
  auditLogs_subjectUserId: many(auditLog, {
    relationName: 'auditLog_subjectUserId_users_id',
  }),
}));

export const authChallengesRelations = relations(authChallenges, ({ one }) => ({
  user: one(users, {
    fields: [authChallenges.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  user_acceptedBy: one(users, {
    fields: [invites.acceptedBy],
    references: [users.id],
    relationName: 'invites_acceptedBy_users_id',
  }),
  family: one(families, {
    fields: [invites.familyId],
    references: [families.id],
  }),
  user_invitedBy: one(users, {
    fields: [invites.invitedBy],
    references: [users.id],
    relationName: 'invites_invitedBy_users_id',
  }),
}));

export const familiesRelations = relations(families, ({ many }) => ({
  invites: many(invites),
  familyMembers: many(familyMembers),
  baskets: many(baskets),
  grants: many(grants),
  auditLogs: many(auditLog),
}));

export const brokerSecretsRelations = relations(brokerSecrets, ({ one }) => ({
  brokerAccount: one(brokerAccounts, {
    fields: [brokerSecrets.brokerAccountId],
    references: [brokerAccounts.id],
  }),
}));

export const brokerAccountsRelations = relations(brokerAccounts, ({ one, many }) => ({
  brokerSecrets: many(brokerSecrets),
  user: one(users, {
    fields: [brokerAccounts.userId],
    references: [users.id],
  }),
  basketItems: many(basketItems),
  grants: many(grants),
  dailyValuations: many(dailyValuations),
  holdings: many(holdings),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  user: one(users, {
    fields: [ledgerEntries.userId],
    references: [users.id],
  }),
}));

export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  family: one(families, {
    fields: [familyMembers.familyId],
    references: [families.id],
  }),
  user: one(users, {
    fields: [familyMembers.userId],
    references: [users.id],
  }),
}));

export const basketItemsRelations = relations(basketItems, ({ one, many }) => ({
  basket: one(baskets, {
    fields: [basketItems.basketId],
    references: [baskets.id],
  }),
  brokerAccount: one(brokerAccounts, {
    fields: [basketItems.ownerUserId],
    references: [brokerAccounts.id],
  }),
  instrument: one(instruments, {
    fields: [basketItems.instrumentId],
    references: [instruments.id],
  }),
  orders: many(orders),
}));

export const basketsRelations = relations(baskets, ({ one, many }) => ({
  basketItems: many(basketItems),
  passkey: one(passkeys, {
    fields: [baskets.ownerUserId],
    references: [passkeys.id],
  }),
  user_createdBy: one(users, {
    fields: [baskets.createdBy],
    references: [users.id],
    relationName: 'baskets_createdBy_users_id',
  }),
  family: one(families, {
    fields: [baskets.familyId],
    references: [families.id],
  }),
  grant: one(grants, {
    fields: [baskets.grantId],
    references: [grants.id],
  }),
  user_ownerUserId: one(users, {
    fields: [baskets.ownerUserId],
    references: [users.id],
    relationName: 'baskets_ownerUserId_users_id',
  }),
}));

export const instrumentsRelations = relations(instruments, ({ many }) => ({
  basketItems: many(basketItems),
  instrumentBrokerIds: many(instrumentBrokerIds),
  holdings: many(holdings),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  basketItem: one(basketItems, {
    fields: [orders.basketItemId],
    references: [basketItems.id],
  }),
}));

export const grantsRelations = relations(grants, ({ one, many }) => ({
  baskets: many(baskets),
  brokerAccount: one(brokerAccounts, {
    fields: [grants.grantorUserId],
    references: [brokerAccounts.id],
  }),
  family: one(families, {
    fields: [grants.familyId],
    references: [families.id],
  }),
  user_granteeUserId: one(users, {
    fields: [grants.granteeUserId],
    references: [users.id],
    relationName: 'grants_granteeUserId_users_id',
  }),
  user_grantorUserId: one(users, {
    fields: [grants.grantorUserId],
    references: [users.id],
    relationName: 'grants_grantorUserId_users_id',
  }),
  user_revokedBy: one(users, {
    fields: [grants.revokedBy],
    references: [users.id],
    relationName: 'grants_revokedBy_users_id',
  }),
}));

export const instrumentBrokerIdsRelations = relations(instrumentBrokerIds, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentBrokerIds.instrumentId],
    references: [instruments.id],
  }),
}));

export const dailyValuationsRelations = relations(dailyValuations, ({ one }) => ({
  brokerAccount: one(brokerAccounts, {
    fields: [dailyValuations.brokerAccountId],
    references: [brokerAccounts.id],
  }),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  brokerAccount: one(brokerAccounts, {
    fields: [holdings.brokerAccountId],
    references: [brokerAccounts.id],
  }),
  instrument: one(instruments, {
    fields: [holdings.instrumentId],
    references: [instruments.id],
  }),
}));

export const killSwitchesRelations = relations(killSwitches, ({ one }) => ({
  user: one(users, {
    fields: [killSwitches.changedBy],
    references: [users.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user_actorUserId: one(users, {
    fields: [auditLog.actorUserId],
    references: [users.id],
    relationName: 'auditLog_actorUserId_users_id',
  }),
  family: one(families, {
    fields: [auditLog.familyId],
    references: [families.id],
  }),
  user_subjectUserId: one(users, {
    fields: [auditLog.subjectUserId],
    references: [users.id],
    relationName: 'auditLog_subjectUserId_users_id',
  }),
}));
