import type { ApproveBasketInput, CreateBasketInput } from '@bargad/shared';
import { z } from 'zod';
import type { Db, Tx } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { FamilyService } from '#modules/families/family/family.service';
import { BrokerRepository } from '#modules/trading/broker/broker.repository';
import { InstrumentRepository } from '#modules/trading/instrument/instrument.repository';
import type { User } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';
import { decodeCursor, isRealTimestamp } from '#utils/http/pagination.util';
import type { Basket } from './basket.query';
import { BasketRepository } from './basket.repository';

export const notFound = () => new ApiError(404, 'Basket not found');

export const invalidState = () =>
  new ApiError(409, 'This basket can no longer change that way', { code: 'invalid_state' });

export const grantInactive = () => new ApiError(409, 'This grant is no longer active', { code: 'grant_inactive' });

export const distinct = (values: string[]) => [...new Set(values)];

export const cursorSchema = z.object({ at: z.string().refine(isRealTimestamp), id: z.uuid() });

export const parseCursor = (cursor: string) => {
  const parsed = cursorSchema.safeParse(decodeCursor<unknown>(cursor));
  if (!parsed.success) throw new ApiError(400, 'Invalid cursor', { code: 'invalid_cursor' });
  return parsed.data;
};

export const withItems = async (basket: Basket, conn?: Db) => ({
  ...basket,
  items: await BasketRepository.listItems(basket.id, conn),
});

export const audit = (tx: Tx, action: string, actorUserId: string, basket: Basket, detail?: Record<string, unknown>) =>
  AuditService.recordAudit(tx, {
    action,
    actorUserId,
    subjectUserIds: distinct([basket.ownerUserId, basket.createdBy]),
    familyId: basket.familyId,
    targetType: 'basket',
    targetId: basket.id,
    detail,
  });

// Who the basket trades for: the creator themself, or (mode 1) a member the head proposes to.
export async function requireOwner(creator: User, input: CreateBasketInput) {
  const membership = await FamilyService.findMembership(creator.id);
  if (!membership) throw new ApiError(409, 'You are not in a family', { code: 'not_in_family' });
  if (input.mode === 'self') {
    if (input.ownerUserId !== creator.id) {
      throw new ApiError(400, 'You can only trade on your own accounts', { code: 'invalid_owner' });
    }
    // View-only members, and members who have not re-declared since a handover, cannot trade.
    if (!membership.canTrade) {
      throw new ApiError(403, 'Your family relationship does not allow trading', { code: 'cannot_trade' });
    }
    return membership;
  }
  if (membership.role !== 'head') throw new ApiError(403, 'Only the family head can do this', { code: 'not_head' });
  const owner =
    input.ownerUserId === creator.id
      ? undefined
      : await FamilyRepository.findActiveMember(membership.familyId, input.ownerUserId);
  if (!owner) throw new ApiError(404, 'Member not found', { code: 'member_not_found' });
  if (!owner.canTrade) {
    throw new ApiError(403, 'Their family relationship does not allow trading on their behalf', {
      code: 'cannot_trade',
    });
  }
  return membership;
}

export async function requireTradableItems(ownerUserId: string, items: CreateBasketInput['items'], tx: Tx) {
  for (const accountId of distinct(items.map((item) => item.brokerAccountId))) {
    const account = await BrokerRepository.findOwned(accountId, ownerUserId, tx);
    if (account?.status !== 'active') {
      throw new ApiError(400, 'One of the broker accounts cannot trade', { code: 'invalid_account' });
    }
  }
  const instrumentIds = distinct(items.map((item) => item.instrumentId));
  if ((await InstrumentRepository.findByIds(instrumentIds, tx)).length !== instrumentIds.length) {
    throw new ApiError(400, 'One of the instruments was not found', { code: 'invalid_instrument' });
  }
}

export function requireWithinGrant(
  grant: { brokerAccountId: string | null; allowedInstrumentIds: string[] | null },
  items: CreateBasketInput['items'],
) {
  const allowed = grant.allowedInstrumentIds && new Set(grant.allowedInstrumentIds);
  const outside = items.some(
    (item) =>
      (grant.brokerAccountId !== null && item.brokerAccountId !== grant.brokerAccountId) ||
      (allowed && !allowed.has(item.instrumentId)),
  );
  if (outside) throw new ApiError(400, 'Some items are outside what the grant allows', { code: 'outside_grant' });
}

// The owner always sees their basket; its creator only while heading the family the owner is still in,
// and only for baskets from the owner's current membership.
export async function isVisible(viewerId: string, basket: Basket, conn?: Db) {
  if (basket.ownerUserId === viewerId) return true;
  if (basket.createdBy !== viewerId) return false;
  return BasketRepository.isSeenByHead(basket.id, viewerId, conn);
}

export async function findVisible(viewerId: string, id: string) {
  const basket = await BasketRepository.findById(id);
  if (!basket || !(await isVisible(viewerId, basket))) throw notFound();
  return basket;
}

export function requireEveryItemPricedOnce(items: { id: string }[], prices: ApproveBasketInput['items']) {
  const priced = new Set(prices.map((price) => price.itemId));
  const exact =
    priced.size === prices.length && priced.size === items.length && items.every((item) => priced.has(item.id));
  if (!exact) throw new ApiError(400, 'Give a price for every item in the basket', { code: 'invalid_items' });
}

// Consent only counts while the owner may still be traded for and the proposer still heads their family.
export async function requireFamilyUnchanged(basket: Basket) {
  const owner = await FamilyRepository.findActiveMember(basket.familyId, basket.ownerUserId);
  const head = await FamilyRepository.findHead(basket.familyId);
  if (!owner?.canTrade || head?.userId !== basket.createdBy) throw invalidState();
}
