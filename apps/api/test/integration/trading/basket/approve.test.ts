import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, basketItems, baskets, familyMembers, jobs } from '#database/schema';
import { BasketRepository } from '#modules/trading/basket/basket.repository';
import {
  addMember,
  createBasket,
  createBrokerAccount,
  createFamily,
  createInstrument,
  createUser,
  signIn,
} from '#test/integration/fixtures';
import { registerPasskey, signStepUp } from '#test/integration/webauthn';
import { marketCloseOf, tradingDayFor } from '#utils/time/market.util';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, data: json.data, code: json.code as string | undefined };
};

// Today's trading day, or the next one when today's close is only minutes away.
const approvableDay = () => {
  const today = tradingDayFor(new Date(), new Set());
  if (marketCloseOf(today).getTime() - Date.now() > 5 * 60_000) return today;
  return tradingDayFor(new Date(Date.now() + 10 * 60_000), new Set());
};

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000).toISOString().slice(0, 10);

// A head's proposed basket for a member who has a passkey: one item on each of two accounts.
async function proposed(tradingDay = approvableDay()) {
  const head = await createUser();
  const { family } = await createFamily(head.id);
  const member = await createUser();
  const membership = await addMember(family.id, member.id, 'dependent_parent');
  const memberHeaders = await signIn(member.id);
  const { passkeyId, authenticator } = await registerPasskey(memberHeaders);
  const accounts = [await createBrokerAccount(member.id), await createBrokerAccount(member.id)];
  const instrument = await createInstrument();
  const basket = await createBasket(
    { familyId: family.id, ownerUserId: member.id, createdBy: head.id, mode: 'approval', tradingDay },
    accounts.map((account) => ({ brokerAccountId: account.id, instrumentId: instrument.id, quantity: 5 })),
  );
  const items = await db.select().from(basketItems).where(eq(basketItems.basketId, basket.id));
  const prices = items.map((item, i) => ({ itemId: item.id, refPricePaise: 10_000 + i }));
  return {
    head,
    headHeaders: await signIn(head.id),
    member,
    membership,
    memberHeaders,
    passkeyId,
    authenticator,
    accounts,
    basket,
    prices,
  };
}

type Proposed = Awaited<ReturnType<typeof proposed>>;

const approve = async (p: Proposed, items = p.prices, targetId = p.basket.id, headers = p.memberHeaders) =>
  send('POST', `/baskets/${p.basket.id}/approval`, headers, {
    assertion: await signStepUp(p.memberHeaders, p.authenticator, 'approve', targetId),
    items,
  });

const statusOf = async (basketId: string) =>
  (await db.select({ status: baskets.status }).from(baskets).where(eq(baskets.id, basketId)))[0]?.status;

describe('POST /baskets/:id/approval', () => {
  test('the owner approves with a passkey: queued, prices stored, one job per account', async () => {
    const p = await proposed();

    const res = await approve(p);

    expect(res.status).toBe(200);
    expect(res.data.basket).toMatchObject({
      status: 'queued',
      approvalExpiresAt: marketCloseOf(p.basket.tradingDay).toISOString(),
    });
    expect(res.data.basket.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const [row] = await db.select().from(baskets).where(eq(baskets.id, p.basket.id));
    expect(row?.approvedPasskeyId).toBe(p.passkeyId);
    const items = await db.select().from(basketItems).where(eq(basketItems.basketId, p.basket.id));
    for (const price of p.prices) {
      expect(items.find((i) => i.id === price.itemId)?.refPricePaise).toBe(price.refPricePaise);
    }
    const queued = await db.select().from(jobs);
    expect(queued.map((j) => j.lane).sort()).toEqual(p.accounts.map((a) => a.id).sort());
    const approvedAtMs = Date.parse(res.data.basket.approvedAt);
    expect(queued.find((j) => j.lane === p.accounts[0]?.id)).toMatchObject({
      kind: 'execute_basket',
      payload: { basketId: p.basket.id, brokerAccountId: p.accounts[0]?.id },
      dedupeKey: `execute_basket:${p.basket.id}:${p.accounts[0]?.id}:${approvedAtMs}`,
    });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.approved'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([p.head.id, p.member.id].sort());
    for (const audit of audits) expect(audit.detail).toEqual({ passkeyId: p.passkeyId });
  });

  test('a basket that is no longer proposed returns 409 invalid_state and queues nothing', async () => {
    const p = await proposed();
    const assertion = await signStepUp(p.memberHeaders, p.authenticator, 'approve', p.basket.id);
    await db.update(baskets).set({ status: 'rejected' }).where(eq(baskets.id, p.basket.id));

    const res = await send('POST', `/baskets/${p.basket.id}/approval`, p.memberHeaders, {
      assertion,
      items: p.prices,
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('invalid_state');
    expect(await db.select().from(jobs)).toEqual([]);
    const items = await db.select().from(basketItems).where(eq(basketItems.basketId, p.basket.id));
    expect(items.every((i) => i.refPricePaise === null)).toBe(true);
  });

  test('an assertion signed for another basket returns 403 passkey_failed', async () => {
    const p = await proposed();

    const res = await approve(p, p.prices, crypto.randomUUID());

    expect(res.status).toBe(403);
    expect(res.code).toBe('passkey_failed');
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });

  test('the head who proposed it cannot approve it', async () => {
    const p = await proposed();

    const res = await send('POST', `/baskets/${p.basket.id}/approval`, p.headHeaders, {
      assertion: await signStepUp(p.memberHeaders, p.authenticator, 'approve', p.basket.id),
      items: p.prices,
    });

    expect(res.status).toBe(404);
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });

  test.each([
    ['missing an item', (p: Proposed) => p.prices.slice(1)],
    [
      'naming an unknown item',
      (p: Proposed) => [...p.prices.slice(1), { itemId: crypto.randomUUID(), refPricePaise: 1 }],
    ],
    ['pricing an item twice', (p: Proposed) => [...p.prices, ...p.prices.slice(0, 1)]],
  ])('prices %s return 400 invalid_items', async (_name, pick) => {
    const p = await proposed();

    const res = await approve(p, pick(p));

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_items');
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });

  test('two simultaneous approvals: one wins, one gets 409, one set of jobs', async () => {
    const p = await proposed();
    const assertions = [
      await signStepUp(p.memberHeaders, p.authenticator, 'approve', p.basket.id),
      await signStepUp(p.memberHeaders, p.authenticator, 'approve', p.basket.id),
    ];

    const results = await Promise.all(
      assertions.map((assertion) =>
        send('POST', `/baskets/${p.basket.id}/approval`, p.memberHeaders, { assertion, items: p.prices }),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.select().from(jobs)).toHaveLength(p.accounts.length);
  });

  test('a basket for a trading day already closed returns 409 basket_expired and expires', async () => {
    const p = await proposed(daysAgo(2));

    const res = await approve(p);

    expect(res.status).toBe(409);
    expect(res.code).toBe('basket_expired');
    expect(await statusOf(p.basket.id)).toBe('expired');
    expect(await db.select().from(jobs)).toEqual([]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.expired'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([p.head.id, p.member.id].sort());
    expect(audits[0]).toMatchObject({ actorUserId: p.member.id, targetId: p.basket.id });
  });

  test('a self basket cannot be approved: 409 invalid_state', async () => {
    const p = await proposed();
    const own = await createBasket(
      { familyId: p.membership.familyId, ownerUserId: p.member.id, createdBy: p.member.id, mode: 'self' },
      [{ brokerAccountId: p.accounts[0]?.id ?? '', instrumentId: (await createInstrument()).id }],
    );
    const [item] = await db.select().from(basketItems).where(eq(basketItems.basketId, own.id));

    const res = await send('POST', `/baskets/${own.id}/approval`, p.memberHeaders, {
      assertion: await signStepUp(p.memberHeaders, p.authenticator, 'approve', own.id),
      items: [{ itemId: item?.id, refPricePaise: 100 }],
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('invalid_state');
    expect(await statusOf(own.id)).toBe('proposed');
  });

  test('an owner who has left the family cannot approve: 409 invalid_state', async () => {
    const p = await proposed();
    await db
      .update(familyMembers)
      .set({ leftAt: new Date().toISOString(), leftReason: 'left' })
      .where(eq(familyMembers.id, p.membership.id));

    const res = await approve(p);

    expect(res.status).toBe(409);
    expect(res.code).toBe('invalid_state');
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });
});

describe('approval when the family changed after the proposal', () => {
  const becomeOther = (p: Proposed) =>
    db.update(familyMembers).set({ relationship: 'other' }).where(eq(familyMembers.id, p.membership.id));
  const headStepsDown = (p: Proposed) =>
    db.update(familyMembers).set({ role: 'member', relationship: null }).where(eq(familyMembers.userId, p.head.id));

  test.each([
    ['the owner became view-only', becomeOther],
    ['the proposer is no longer head', headStepsDown],
  ])('is refused with 409 invalid_state and no jobs when %s', async (_name, change) => {
    const p = await proposed();
    await change(p);

    const res = await approve(p);

    expect(res.status).toBe(409);
    expect(res.code).toBe('invalid_state');
    expect(await db.select().from(jobs)).toEqual([]);
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });

  // The service checks the family first; the update re-checks it so a change committed in between still loses.
  test.each([
    ['the owner became view-only', becomeOther],
    ['the proposer is no longer head', headStepsDown],
  ])('markApproved updates nothing when %s', async (_name, change) => {
    const p = await proposed();
    await change(p);

    const approved = await BasketRepository.markApproved(p.basket.id, p.passkeyId, new Date(), db);

    expect(approved).toBeUndefined();
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });

  test('markApproved approves while the family is unchanged', async () => {
    const p = await proposed();

    const approved = await BasketRepository.markApproved(p.basket.id, p.passkeyId, new Date(), db);

    expect(approved?.status).toBe('queued');
  });
});

describe('POST /baskets/:id/rejection', () => {
  test('the owner rejects a proposed basket once', async () => {
    const p = await proposed();

    const first = await send('POST', `/baskets/${p.basket.id}/rejection`, p.memberHeaders);
    const again = await send('POST', `/baskets/${p.basket.id}/rejection`, p.memberHeaders);

    expect(first.status).toBe(200);
    expect(first.data.basket.status).toBe('rejected');
    expect(again.status).toBe(409);
    expect(again.code).toBe('invalid_state');
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.rejected'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([p.head.id, p.member.id].sort());
  });

  test('the creator cannot reject: 404', async () => {
    const p = await proposed();

    const res = await send('POST', `/baskets/${p.basket.id}/rejection`, p.headHeaders);

    expect(res.status).toBe(404);
    expect(await statusOf(p.basket.id)).toBe('proposed');
  });
});

describe('DELETE /baskets/:id', () => {
  test('the creator cancels a proposed basket without a job', async () => {
    const p = await proposed();

    const res = await send('DELETE', `/baskets/${p.basket.id}`, p.headHeaders);

    expect(res.status).toBe(200);
    expect(res.data.basket.status).toBe('cancelled');
    expect(await db.select().from(jobs)).toEqual([]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.cancelled'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([p.head.id, p.member.id].sort());
  });

  test('the owner cancels a queued basket and the engine is told', async () => {
    const p = await proposed();
    await db.update(baskets).set({ status: 'queued' }).where(eq(baskets.id, p.basket.id));

    const res = await send('DELETE', `/baskets/${p.basket.id}`, p.memberHeaders);

    expect(res.status).toBe(200);
    expect(res.data.basket.status).toBe('cancelled');
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      kind: 'cancel_basket',
      payload: { basketId: p.basket.id },
      dedupeKey: `cancel_basket:${p.basket.id}`,
    });
  });

  test('a done basket cannot be cancelled: 409', async () => {
    const p = await proposed();
    await db.update(baskets).set({ status: 'done' }).where(eq(baskets.id, p.basket.id));

    const res = await send('DELETE', `/baskets/${p.basket.id}`, p.memberHeaders);

    expect(res.status).toBe(409);
    expect(res.code).toBe('invalid_state');
  });
});
