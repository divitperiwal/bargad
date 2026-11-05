import type { ApproveBasketInput, CreateBasketInput, ListBasketsQuery } from '@bargad/shared';
import { type Tx, withTransaction } from '#config/database.config';
import { JOB, JobsRepository } from '#jobs/queue.repository';
import { PasskeyService } from '#modules/accounts/passkey/passkey.service';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { GrantRepository } from '#modules/trading/grant/grant.repository';
import type { User } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';
import { toPage } from '#utils/http/pagination.util';
import { marketCloseOf, tradingDayFor } from '#utils/time/market.util';
import {
  audit,
  distinct,
  findVisible,
  grantInactive,
  invalidState,
  notFound,
  parseCursor,
  requireEveryItemPricedOnce,
  requireFamilyUnchanged,
  requireOwner,
  requireTradableItems,
  requireWithinGrant,
  withItems,
} from './basket.helper';
import { BasketRepository } from './basket.repository';

// Mode 2: the head trades for the grantor without asking, within the grant's static limits.
// The engine enforces the rupee caps at order time, where the price is known.
async function placeUnderGrant(creator: User, input: CreateBasketInput) {
  return withTransaction(async (tx) => {
    const grant = input.grantId
      ? await GrantRepository.findForBasket(input.grantId, creator.id, input.ownerUserId, tx)
      : undefined;
    if (!grant) throw new ApiError(404, 'Grant not found', { code: 'grant_not_found' });
    if (!grant.inWindow) throw grantInactive();
    const head = await FamilyRepository.findHead(grant.familyId, tx);
    const owner = await FamilyRepository.findActiveMember(grant.familyId, input.ownerUserId, tx);
    if (head?.userId !== creator.id || !owner?.canTrade) throw grantInactive();
    requireWithinGrant(grant, input.items);
    await requireTradableItems(input.ownerUserId, input.items, tx);
    const tradingDay = tradingDayFor(new Date(), await BasketRepository.upcomingNseHolidays(tx));
    const basket = await BasketRepository.insert(
      {
        familyId: grant.familyId,
        ownerUserId: input.ownerUserId,
        createdBy: creator.id,
        mode: 'grant',
        grantId: grant.id,
        bandBps: input.bandBps,
        status: 'queued',
        tradingDay,
      },
      input.items,
      tx,
    );
    await BasketService.enqueueExecution(
      tx,
      basket,
      input.items.map((item) => item.brokerAccountId),
      0,
    );
    await audit(tx, 'basket.placed_under_grant', creator.id, basket, {
      grantId: grant.id,
      itemCount: input.items.length,
    });
    return withItems(basket, tx);
  });
}

export const BasketService = {
  create: async (creator: User, input: CreateBasketInput) => {
    if (input.mode === 'grant') return placeUnderGrant(creator, input);
    const membership = await requireOwner(creator, input);
    const mode = input.mode;
    return withTransaction(async (tx) => {
      await requireTradableItems(input.ownerUserId, input.items, tx);
      const tradingDay = tradingDayFor(new Date(), await BasketRepository.upcomingNseHolidays(tx));
      const basket = await BasketRepository.insert(
        {
          familyId: membership.familyId,
          ownerUserId: input.ownerUserId,
          createdBy: creator.id,
          mode,
          bandBps: input.bandBps,
          status: mode === 'self' ? 'queued' : 'proposed',
          tradingDay,
        },
        input.items,
        tx,
      );
      if (mode === 'self') {
        await BasketService.enqueueExecution(
          tx,
          basket,
          input.items.map((item) => item.brokerAccountId),
          0,
        );
        await audit(tx, 'basket.created', creator.id, basket);
      } else {
        await audit(tx, 'basket.proposed', creator.id, basket, { itemCount: input.items.length });
      }
      return withItems(basket, tx);
    });
  },

  get: async (userId: string, id: string) => {
    const basket = await findVisible(userId, id);
    return { basket: await withItems(basket), orders: await BasketRepository.listOrders(id) };
  },

  list: async (userId: string, query: ListBasketsQuery) => {
    const after = query.cursor ? parseCursor(query.cursor) : undefined;
    const rows = await BasketRepository.findPage(userId, query, after);
    return toPage(rows, query.limit);
  },

  approve: async (userId: string, id: string, input: ApproveBasketInput) => {
    const basket = await BasketRepository.findById(id);
    if (!basket || basket.ownerUserId !== userId) throw notFound();
    if (basket.mode !== 'approval') throw invalidState();
    const items = await BasketRepository.listItems(id);
    requireEveryItemPricedOnce(items, input.items);
    const { passkeyId } = await PasskeyService.verifyStepUp({
      userId,
      purpose: 'approve',
      targetId: id,
      assertion: input.assertion,
    });
    await requireFamilyUnchanged(basket);
    const closesAt = marketCloseOf(basket.tradingDay);
    if (Date.now() >= closesAt.getTime()) {
      await withTransaction(async (tx) => {
        const expired = await BasketRepository.transition(id, 'proposed', 'expired', tx);
        if (expired) await audit(tx, 'basket.expired', userId, expired);
      });
      throw new ApiError(409, 'This basket expired when the market closed', { code: 'basket_expired' });
    }

    return withTransaction(async (tx) => {
      const approved = await BasketRepository.markApproved(id, passkeyId, closesAt, tx);
      if (!approved?.approvedAt) throw invalidState();
      for (const price of input.items) {
        await BasketRepository.setRefPrice(id, price.itemId, price.refPricePaise, tx);
      }
      await BasketService.enqueueExecution(
        tx,
        approved,
        items.map((item) => item.brokerAccountId),
        Date.parse(approved.approvedAt),
      );
      await audit(tx, 'basket.approved', userId, approved, { passkeyId });
      return withItems(approved, tx);
    });
  },

  reject: async (userId: string, id: string) => {
    const basket = await BasketRepository.findById(id);
    if (!basket || basket.ownerUserId !== userId) throw notFound();
    return withTransaction(async (tx) => {
      const rejected = await BasketRepository.transition(id, 'proposed', 'rejected', tx);
      if (!rejected) throw invalidState();
      await audit(tx, 'basket.rejected', userId, rejected);
      return withItems(rejected, tx);
    });
  },

  // A queued basket may already be with the engine, so it is told to stand down.
  cancel: async (userId: string, id: string) => {
    await findVisible(userId, id);
    return withTransaction(async (tx) => {
      let cancelled = await BasketRepository.transition(id, 'proposed', 'cancelled', tx);
      if (!cancelled) {
        cancelled = await BasketRepository.transition(id, 'queued', 'cancelled', tx);
        if (!cancelled) throw invalidState();
        await JobsRepository.enqueue(
          { kind: JOB.cancelBasket, payload: { basketId: id }, dedupeKey: `${JOB.cancelBasket}:${id}` },
          tx,
        );
      }
      await audit(tx, 'basket.cancelled', userId, cancelled);
      return withItems(cancelled, tx);
    });
  },

  // One job per account, keyed by the approval so enqueueing the same approval twice queues nothing new.
  enqueueExecution: async (tx: Tx, basket: { id: string }, accountIds: string[], approvedAtMs: number) => {
    for (const accountId of distinct(accountIds)) {
      await JobsRepository.enqueue(
        {
          kind: JOB.executeBasket,
          payload: { basketId: basket.id, brokerAccountId: accountId },
          lane: accountId,
          dedupeKey: `${JOB.executeBasket}:${basket.id}:${accountId}:${approvedAtMs}`,
        },
        tx,
      );
    }
  },
};
