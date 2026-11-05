import { and, eq, exists, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#config/database.config';
import { baskets, familyMembers } from '#database/schema';
import { headSeesRecord } from '#modules/families/family/visibility.query';
import { toIso, toIsoOrNull } from '#utils/time/time.util';

export const basketColumns = {
  id: baskets.id,
  familyId: baskets.familyId,
  ownerUserId: baskets.ownerUserId,
  createdBy: baskets.createdBy,
  mode: baskets.mode,
  grantId: baskets.grantId,
  bandBps: baskets.bandBps,
  status: baskets.status,
  approvedAt: baskets.approvedAt,
  approvalExpiresAt: baskets.approvalExpiresAt,
  tradingDay: baskets.tradingDay,
  createdAt: baskets.createdAt,
  updatedAt: baskets.updatedAt,
};

export type BasketRow = {
  id: string;
  familyId: string;
  ownerUserId: string;
  createdBy: string;
  mode: string;
  grantId: string | null;
  bandBps: number;
  status: string;
  approvedAt: string | null;
  approvalExpiresAt: string | null;
  tradingDay: string;
  createdAt: string;
  updatedAt: string;
};

export const toBasket = (row: BasketRow) => ({
  ...row,
  approvedAt: toIsoOrNull(row.approvedAt),
  approvalExpiresAt: toIsoOrNull(row.approvalExpiresAt),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

export type Basket = ReturnType<typeof toBasket>;

export type NewBasket = {
  familyId: string;
  ownerUserId: string;
  createdBy: string;
  mode: 'self' | 'approval' | 'grant';
  grantId?: string;
  bandBps: number;
  status: 'proposed' | 'queued';
  tradingDay: string;
};

export type NewBasketItem = { brokerAccountId: string; instrumentId: string; side: string; quantity: number };

export type BasketCursor = { at: string; id: string };

export const headMember = alias(familyMembers, 'head_member');

export const ownerMember = alias(familyMembers, 'owner_member');

export const headSeesBasket = (viewerId: string) =>
  headSeesRecord(viewerId, {
    familyId: baskets.familyId,
    ownerUserId: baskets.ownerUserId,
    createdAt: baskets.createdAt,
  });

// The owner is still an active member of the basket's family whose relationship allows trading.
export const ownerMayTrade = exists(
  db
    .select({ one: sql`1` })
    .from(ownerMember)
    .where(
      and(
        eq(ownerMember.familyId, baskets.familyId),
        eq(ownerMember.userId, baskets.ownerUserId),
        isNull(ownerMember.leftAt),
        eq(ownerMember.canTrade, true),
      ),
    ),
);

// The basket's creator is still the active head of its family.
export const creatorStillHeads = exists(
  db
    .select({ one: sql`1` })
    .from(headMember)
    .where(
      and(
        eq(headMember.familyId, baskets.familyId),
        eq(headMember.userId, baskets.createdBy),
        eq(headMember.role, 'head'),
        isNull(headMember.leftAt),
      ),
    ),
);
