import { and, eq, isNull } from 'drizzle-orm';
import { grants } from '#database/schema';

export const OPEN_BASKET = ['proposed', 'queued', 'executing'];

export type CancelledBasket = {
  id: string;
  wasStatus: string;
  familyId: string;
  ownerUserId: string;
  createdBy: string;
};

export const activeGrant = (familyId: string) => and(eq(grants.familyId, familyId), isNull(grants.revokedAt));
