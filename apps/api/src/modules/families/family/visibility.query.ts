import { type AnyColumn, and, eq, exists, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#config/database.config';
import { familyMembers } from '#database/schema';

const headMember = alias(familyMembers, 'seen_by_head');
const ownerMember = alias(familyMembers, 'seen_owner');

type MemberRecord = { familyId: AnyColumn; ownerUserId: AnyColumn; createdAt: AnyColumn };

// A head sees a member's record (a basket, a grant) only while they still head the record's family,
// the member is still in it, and the record is from the member's current membership: a member who
// left and was added again does not bring their old records back into the head's view.
export const headSeesRecord = (viewerId: string, record: MemberRecord) =>
  and(
    exists(
      db
        .select({ one: sql`1` })
        .from(headMember)
        .where(
          and(
            eq(headMember.familyId, record.familyId),
            eq(headMember.userId, viewerId),
            eq(headMember.role, 'head'),
            isNull(headMember.leftAt),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(ownerMember)
        .where(
          and(
            eq(ownerMember.familyId, record.familyId),
            eq(ownerMember.userId, record.ownerUserId),
            isNull(ownerMember.leftAt),
            lte(ownerMember.joinedAt, record.createdAt),
          ),
        ),
    ),
  );
