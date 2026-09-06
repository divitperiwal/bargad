import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '#config/database.config';
import { baskets, grants } from '#database/schema';
import { activeGrant, type CancelledBasket, OPEN_BASKET } from './cascade.query';

export const CascadeRepository = {
  // Active grants where the user gives or receives.
  revokeGrantsOfUser: async (
    familyId: string,
    userId: string,
    reason: 'left' | 'removed',
    revokedBy: string,
    conn: Db,
  ) => {
    await conn
      .update(grants)
      .set({ revokedAt: sql`now()`, revokedBy, revokeReason: reason })
      .where(and(activeGrant(familyId), or(eq(grants.grantorUserId, userId), eq(grants.granteeUserId, userId))));
  },

  revokeAllGrants: async (familyId: string, reason: 'handover' | 'left', revokedBy: string, conn: Db) => {
    await conn
      .update(grants)
      .set({ revokedAt: sql`now()`, revokedBy, revokeReason: reason })
      .where(activeGrant(familyId));
  },

  // Rows are locked while read, so the status reported is the one that was cancelled.
  cancelOpenBaskets: async (
    where: { familyId: string; ownerUserId?: string; grantId?: string },
    conn: Db,
  ): Promise<CancelledBasket[]> => {
    const open = await conn
      .select({
        id: baskets.id,
        wasStatus: baskets.status,
        familyId: baskets.familyId,
        ownerUserId: baskets.ownerUserId,
        createdBy: baskets.createdBy,
      })
      .from(baskets)
      .where(
        and(
          eq(baskets.familyId, where.familyId),
          inArray(baskets.status, OPEN_BASKET),
          where.ownerUserId ? eq(baskets.ownerUserId, where.ownerUserId) : undefined,
          where.grantId ? eq(baskets.grantId, where.grantId) : undefined,
        ),
      )
      .for('update');
    if (open.length === 0) return [];
    await conn
      .update(baskets)
      .set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(
        inArray(
          baskets.id,
          open.map((basket) => basket.id),
        ),
      );
    return open;
  },
};
