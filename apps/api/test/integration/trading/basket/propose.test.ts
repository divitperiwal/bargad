import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, basketItems, familyMembers, jobs } from '#database/schema';
import { InstrumentService } from '#modules/trading/instrument/instrument.service';
import {
  addMember,
  createBrokerAccount,
  createFamily,
  createInstrument,
  createUser,
  signIn,
} from '#test/integration/fixtures';
import { tradingDayFor } from '#utils/time/market.util';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, data: json.data, code: json.code as string | undefined };
};

// A head, a dependent_parent member with one active account, and an instrument.
async function household() {
  const head = await createUser();
  const { family } = await createFamily(head.id);
  const member = await createUser();
  await addMember(family.id, member.id, 'dependent_parent');
  const account = await createBrokerAccount(member.id);
  const instrument = await createInstrument();
  return { head, family, member, account, instrument, headers: await signIn(head.id) };
}

const item = (brokerAccountId: string, instrumentId: string, extra: Record<string, unknown> = {}) => ({
  brokerAccountId,
  instrumentId,
  side: 'buy',
  quantity: 10,
  ...extra,
});

describe('POST /baskets (approval)', () => {
  test('the head proposes a basket for a member', async () => {
    const { head, family, member, account, instrument, headers } = await household();
    const other = await createInstrument();

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: member.id,
      mode: 'approval',
      items: [item(account.id, instrument.id), item(account.id, other.id, { side: 'sell', quantity: 3 })],
    });

    expect(res.status).toBe(201);
    expect(res.data.basket).toMatchObject({
      familyId: family.id,
      ownerUserId: member.id,
      createdBy: head.id,
      mode: 'approval',
      grantId: null,
      bandBps: 100,
      status: 'proposed',
      approvedAt: null,
      approvalExpiresAt: null,
      tradingDay: tradingDayFor(new Date(), new Set()),
    });
    expect(res.data.basket.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(res.data.basket.items).toHaveLength(2);
    expect(res.data.basket.items.find((i: { instrumentId: string }) => i.instrumentId === instrument.id)).toMatchObject(
      {
        brokerAccountId: account.id,
        instrumentId: instrument.id,
        tradingSymbol: instrument.tradingSymbol,
        side: 'buy',
        quantity: 10,
        refPricePaise: null,
      },
    );
    const rows = await db.select().from(basketItems).where(eq(basketItems.basketId, res.data.basket.id));
    expect(rows).toHaveLength(2);
    expect(await db.select().from(jobs)).toEqual([]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.proposed'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([head.id, member.id].sort());
    expect(audits[0]).toMatchObject({ actorUserId: head.id, targetId: res.data.basket.id, detail: { itemCount: 2 } });
  });

  test('a member who is not head gets 403 not_head', async () => {
    const { family, member, account, instrument } = await household();
    const third = await createUser();
    await addMember(family.id, third.id, 'spouse');

    const res = await send('POST', '/baskets', await signIn(third.id), {
      ownerUserId: member.id,
      mode: 'approval',
      items: [item(account.id, instrument.id)],
    });

    expect(res.status).toBe(403);
    expect(res.code).toBe('not_head');
  });

  test('an owner whose relationship is other gets 403 cannot_trade', async () => {
    const { family, instrument, headers } = await household();
    const cousin = await createUser();
    await addMember(family.id, cousin.id, 'other');
    const account = await createBrokerAccount(cousin.id);

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: cousin.id,
      mode: 'approval',
      items: [item(account.id, instrument.id)],
    });

    expect(res.status).toBe(403);
    expect(res.code).toBe('cannot_trade');
  });

  test('an owner in another family gets 404', async () => {
    const { instrument, headers } = await household();
    const stranger = await createUser();
    await createFamily(stranger.id, 'Other');
    const account = await createBrokerAccount(stranger.id);

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: stranger.id,
      mode: 'approval',
      items: [item(account.id, instrument.id)],
    });

    expect(res.status).toBe(404);
    expect(res.code).toBe('member_not_found');
  });

  test('an account that is not the owner gets 400 invalid_account', async () => {
    const { head, member, instrument, headers } = await household();
    const headAccount = await createBrokerAccount(head.id);

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: member.id,
      mode: 'approval',
      items: [item(headAccount.id, instrument.id)],
    });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_account');
  });

  test('an account that needs relinking gets 400 invalid_account', async () => {
    const { member, instrument, headers } = await household();
    const stale = await createBrokerAccount(member.id, { status: 'needs_relink' });

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: member.id,
      mode: 'approval',
      items: [item(stale.id, instrument.id)],
    });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_account');
  });

  test('an unknown instrument gets 400 invalid_instrument', async () => {
    const { member, account, headers } = await household();

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: member.id,
      mode: 'approval',
      items: [item(account.id, crypto.randomUUID())],
    });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_instrument');
  });
});

describe('POST /baskets (self)', () => {
  test('a member trades on two of their own accounts: queued with one job per account', async () => {
    const { member, account, instrument } = await household();
    const second = await createBrokerAccount(member.id);

    const res = await send('POST', '/baskets', await signIn(member.id), {
      ownerUserId: member.id,
      mode: 'self',
      items: [item(account.id, instrument.id), item(second.id, instrument.id)],
    });

    expect(res.status).toBe(201);
    expect(res.data.basket).toMatchObject({ status: 'queued', mode: 'self', createdBy: member.id });
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(2);
    expect(queued.every((j) => j.kind === 'execute_basket')).toBe(true);
    expect(queued.map((j) => j.lane).sort()).toEqual([account.id, second.id].sort());
    expect(queued.find((j) => j.lane === account.id)).toMatchObject({
      payload: { basketId: res.data.basket.id, brokerAccountId: account.id },
      dedupeKey: `execute_basket:${res.data.basket.id}:${account.id}:0`,
    });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.created'));
    expect(audits.map((a) => a.subjectUserId)).toEqual([member.id]);
  });

  test('a self basket for someone else gets 400 invalid_owner', async () => {
    const { member, account, instrument, headers } = await household();

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: member.id,
      mode: 'self',
      items: [item(account.id, instrument.id)],
    });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_owner');
  });

  test.each<[string, string | null]>([
    ['other', 'other'],
    ['not yet declared', null],
  ])('a member whose relationship is %s gets 403 cannot_trade and nothing is queued', async (_name, relationship) => {
    const { family, instrument } = await household();
    const viewer = await createUser();
    const membership = await addMember(family.id, viewer.id, 'spouse');
    await db.update(familyMembers).set({ relationship }).where(eq(familyMembers.id, membership.id));
    const account = await createBrokerAccount(viewer.id);

    const res = await send('POST', '/baskets', await signIn(viewer.id), {
      ownerUserId: viewer.id,
      mode: 'self',
      items: [item(account.id, instrument.id)],
    });

    expect(res.status).toBe(403);
    expect(res.code).toBe('cannot_trade');
    expect(await db.select().from(jobs)).toEqual([]);
  });

  test('a creator with no family gets 409 not_in_family', async () => {
    const loner = await createUser();
    const account = await createBrokerAccount(loner.id);
    const instrument = await createInstrument();

    const res = await send('POST', '/baskets', await signIn(loner.id), {
      ownerUserId: loner.id,
      mode: 'self',
      items: [item(account.id, instrument.id)],
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('not_in_family');
  });
});

describe('POST /baskets validation', () => {
  type Change = { items?: Record<string, unknown>[]; bandBps?: number; grantId?: string };

  test.each<[string, Change]>([
    ['a zero quantity', { items: [{ quantity: 0 }] }],
    ['51 items', { items: Array.from({ length: 51 }, () => ({})) }],
    ['a band over 1000 bps', { bandBps: 1001 }],
    ['a grant id outside grant mode', { grantId: crypto.randomUUID() }],
  ])('rejects %s with 400', async (_name, change) => {
    const { member, account, instrument, headers } = await household();
    const items = (change.items ?? [{}]).map((extra) => item(account.id, instrument.id, extra));

    const res = await send('POST', '/baskets', headers, {
      ownerUserId: member.id,
      mode: 'approval',
      ...change,
      items,
    });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_request');
  });
});

describe('GET /instruments', () => {
  test('matches the upper-cased query as a symbol prefix', async () => {
    const user = await createUser();
    const nifty = await createInstrument({ tradingSymbol: 'NIFTYBEES' });
    await createInstrument({ tradingSymbol: 'BANKBEES' });

    const res = await send('GET', '/instruments?q=nif', await signIn(user.id));

    expect(res.status).toBe(200);
    expect(res.data.items.map((i: { id: string }) => i.id)).toEqual([nifty.id]);
    expect(res.data.items[0]).toMatchObject({ tradingSymbol: 'NIFTYBEES', exchange: 'NSE' });
  });

  test('InstrumentService.search is what the route answers with', async () => {
    const nifty = await createInstrument({ tradingSymbol: 'NIFTYBEES' });

    const found = await InstrumentService.search('nifty');

    expect(found.map((i) => i.id)).toEqual([nifty.id]);
  });

  test('rejects a query longer than 20 characters', async () => {
    const res = await send('GET', `/instruments?q=${'A'.repeat(21)}`, await signIn((await createUser()).id));

    expect(res.status).toBe(400);
  });
});
