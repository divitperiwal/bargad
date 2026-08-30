import { and, asc, eq, gt, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { families, familyMembers, invites, users } from '#database/schema';
import { toIso } from '#utils/time/time.util';
import {
  active,
  familyColumns,
  inviteColumns,
  membershipColumns,
  pending,
  type Relationship,
  toMembership,
} from './family.query';

export const FamilyRepository = {
  insertFamily: async (name: string, conn: Db = db) => {
    const [row] = await conn.insert(families).values({ name }).returning(familyColumns);
    if (!row) throw new Error('family insert returned nothing');
    return { ...row, createdAt: toIso(row.createdAt) };
  },

  insertMember: async (
    values: { familyId: string; userId: string; role: 'head' | 'member'; relationship: Relationship },
    conn: Db = db,
  ) => {
    const [row] = await conn.insert(familyMembers).values(values).returning(membershipColumns);
    if (!row) throw new Error('member insert returned nothing');
    return toMembership(row);
  },

  // Serialises dissolving a family against joining it; true while the family is not dissolved.
  // NO KEY UPDATE still excludes other lockFamily callers but, unlike FOR UPDATE, does not block
  // the KEY SHARE lock a foreign-key insert takes on families, so it cannot deadlock with one.
  lockFamily: async (familyId: string, conn: Db) => {
    const [row] = await conn
      .select({ dissolvedAt: families.dissolvedAt })
      .from(families)
      .where(eq(families.id, familyId))
      .for('no key update');
    return row !== undefined && row.dissolvedAt === null;
  },

  findFamily: async (familyId: string, conn: Db = db) => {
    const [row] = await conn.select(familyColumns).from(families).where(eq(families.id, familyId));
    return row && { ...row, createdAt: toIso(row.createdAt) };
  },

  findActiveMemberOfUser: async (userId: string, conn: Db = db) => {
    const [row] = await conn
      .select(membershipColumns)
      .from(familyMembers)
      .where(and(eq(familyMembers.userId, userId), active));
    return row && toMembership(row);
  },

  findActiveMember: async (familyId: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .select(membershipColumns)
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId), active));
    return row && toMembership(row);
  },

  findHead: async (familyId: string, conn: Db = db) => {
    const [row] = await conn
      .select(membershipColumns)
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.role, 'head'), active));
    return row && toMembership(row);
  },

  // The active rows of these users, held FOR SHARE: a leave, removal or handover touching them
  // waits for the caller's transaction, and then its cascade sees what the caller wrote.
  lockActiveMembers: async (familyId: string, userIds: string[], conn: Db) => {
    const rows = await conn
      .select(membershipColumns)
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), inArray(familyMembers.userId, userIds), active))
      .for('share');
    return rows.map(toMembership);
  },

  findActiveMemberById: async (familyId: string, memberId: string, conn: Db = db) => {
    const [row] = await conn
      .select(membershipColumns)
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.id, memberId), active));
    return row && toMembership(row);
  },

  // Undefined when the member had already left, so two simultaneous exits cannot both win.
  markLeft: async (memberId: string, reason: 'left' | 'removed', conn: Db = db) => {
    const [row] = await conn
      .update(familyMembers)
      .set({ leftAt: sql`now()`, leftReason: reason })
      .where(and(eq(familyMembers.id, memberId), active))
      .returning({ id: familyMembers.id });
    return row;
  },

  revokePendingInvitesOfFamily: async (familyId: string, conn: Db = db) => {
    await conn
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(invites.familyId, familyId), pending));
  },

  markAllLeft: async (familyId: string, reason: 'dissolved', conn: Db = db) => {
    await conn
      .update(familyMembers)
      .set({ leftAt: sql`now()`, leftReason: reason })
      .where(and(eq(familyMembers.familyId, familyId), active));
  },

  markDissolved: async (familyId: string, conn: Db = db) => {
    await conn.update(families).set({ dissolvedAt: sql`now()` }).where(eq(families.id, familyId));
  },

  demote: async (memberId: string, conn: Db = db) => {
    await conn.update(familyMembers).set({ role: 'member', relationship: null }).where(eq(familyMembers.id, memberId));
  },

  // Undefined when the member is no longer active, so a head is never an inactive row.
  promote: async (memberId: string, conn: Db = db) => {
    const [row] = await conn
      .update(familyMembers)
      .set({ role: 'head', relationship: 'self' })
      .where(and(eq(familyMembers.id, memberId), active))
      .returning({ id: familyMembers.id });
    return row;
  },

  clearRelationshipsExcept: async (familyId: string, keepMemberIds: string[], conn: Db = db) => {
    await conn
      .update(familyMembers)
      .set({ relationship: null })
      .where(and(eq(familyMembers.familyId, familyId), active, notInArray(familyMembers.id, keepMemberIds)));
  },

  // One conditional update; undefined when the member already declared a relationship.
  declareRelationship: async (memberId: string, relationship: Relationship, conn: Db = db) => {
    const [row] = await conn
      .update(familyMembers)
      .set({ relationship })
      .where(and(eq(familyMembers.id, memberId), isNull(familyMembers.relationship), active))
      .returning(membershipColumns);
    return row && toMembership(row);
  },

  listActiveMembers: async (familyId: string, conn: Db = db) => {
    const rows = await conn
      .select({
        memberId: familyMembers.id,
        userId: familyMembers.userId,
        displayName: users.displayName,
        role: familyMembers.role,
        relationship: familyMembers.relationship,
        canTrade: familyMembers.canTrade,
        joinedAt: familyMembers.joinedAt,
      })
      .from(familyMembers)
      .innerJoin(users, eq(users.id, familyMembers.userId))
      .where(and(eq(familyMembers.familyId, familyId), active))
      .orderBy(asc(familyMembers.joinedAt));
    return rows.map((row) => ({ ...row, joinedAt: toIso(row.joinedAt) }));
  },

  findActiveMemberByEmail: async (familyId: string, email: string, conn: Db = db) => {
    const [row] = await conn
      .select({ memberId: familyMembers.id })
      .from(familyMembers)
      .innerJoin(users, eq(users.id, familyMembers.userId))
      .where(and(eq(familyMembers.familyId, familyId), eq(users.email, email), active));
    return row;
  },

  revokePendingByEmail: (familyId: string, email: string, conn: Db = db) =>
    conn
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(invites.familyId, familyId), eq(invites.email, email), pending)),

  insertInvite: async (
    values: { familyId: string; invitedBy: string; email: string; relationship: string; tokenHash: Uint8Array },
    conn: Db = db,
  ) => {
    const [row] = await conn.insert(invites).values(values).returning(inviteColumns);
    if (!row) throw new Error('invite insert returned nothing');
    return { ...row, expiresAt: toIso(row.expiresAt) };
  },

  listPendingInvites: async (familyId: string, conn: Db = db) => {
    const rows = await conn
      .select({
        ...inviteColumns,
        createdAt: invites.createdAt,
        expired: sql<boolean>`${invites.expiresAt} <= now()`,
      })
      .from(invites)
      .where(and(eq(invites.familyId, familyId), pending))
      .orderBy(asc(invites.createdAt));
    return rows.map((row) => ({ ...row, createdAt: toIso(row.createdAt), expiresAt: toIso(row.expiresAt) }));
  },

  // Undefined when the invite is unknown, in another family, accepted or already revoked.
  revokeInvite: async (id: string, familyId: string, conn: Db = db) => {
    const [row] = await conn
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(invites.id, id), eq(invites.familyId, familyId), pending))
      .returning({ id: invites.id, email: invites.email });
    return row;
  },

  // A pending invite that has not expired, with what the preview and acceptance need.
  findOpenInviteByHash: async (tokenHash: Uint8Array, conn: Db = db) => {
    const [row] = await conn
      .select({
        id: invites.id,
        familyId: invites.familyId,
        familyName: families.name,
        invitedBy: invites.invitedBy,
        invitedByName: users.displayName,
        email: invites.email,
        relationship: invites.relationship,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .innerJoin(families, eq(families.id, invites.familyId))
      .innerJoin(users, eq(users.id, invites.invitedBy))
      .where(
        and(eq(invites.tokenHash, tokenHash), pending, gt(invites.expiresAt, sql`now()`), isNull(families.dissolvedAt)),
      );
    return row && { ...row, expiresAt: toIso(row.expiresAt) };
  },

  // One conditional update, so only one of two simultaneous acceptances wins.
  markInviteAccepted: async (id: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .update(invites)
      .set({ acceptedAt: sql`now()`, acceptedBy: userId })
      .where(and(eq(invites.id, id), pending, gt(invites.expiresAt, sql`now()`)))
      .returning({ id: invites.id });
    return row;
  },
};
