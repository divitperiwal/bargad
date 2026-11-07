import { describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { basketItems, familyMembers, orders } from '#database/schema';
import {
  addMember,
  createBasket,
  createBrokerAccount,
  createFamily,
  createInstrument,
  createUser,
  signIn,
} from '#test/integration/fixtures';

const get = async (path: string, headers: Record<string, string>) => {
  const res = await app.request(path, { headers });
  const json = await res.json();
  return { status: res.status, data: json.data, code: json.code as string | undefined };
};

// A head, a member, and a proposed basket the head made for the member.
async function household() {
  const head = await createUser();
  const { family } = await createFamily(head.id);
  const member = await createUser();
  const membership = await addMember(family.id, member.id, 'dependent_parent');
  const account = await createBrokerAccount(member.id);
  const instrument = await createInstrument({ tradingSymbol: 'NIFTYBEES' });
  const propose = (fields: { status?: string } = {}) =>
    createBasket({ familyId: family.id, ownerUserId: member.id, createdBy: head.id, mode: 'approval', ...fields }, [
      { brokerAccountId: account.id, instrumentId: instrument.id, quantity: 4 },
    ]);
  return {
    head,
    family,
    member,
    membership,
    account,
    instrument,
    propose,
    headHeaders: await signIn(head.id),
    memberHeaders: await signIn(member.id),
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('GET /baskets/:id', () => {
  test('the owner and the head see the items and orders', async () => {
    const h = await household();
    const basket = await h.propose({ status: 'executing' });
    const [item] = await db.select().from(basketItems).where(eq(basketItems.basketId, basket.id));
    if (!item) throw new Error('no item');
    const [order] = await db
      .insert(orders)
      .values({
        basketItemId: item.id,
        brokerAccountId: h.account.id,
        side: 'buy',
        quantity: 4,
        refPricePaise: 10_000,
        bandBps: 100,
        limitPricePaise: 10_050,
        status: 'partial',
        filledQty: 2,
        avgFillPaise: 10_020,
        tradingDay: basket.tradingDay,
      })
      .returning();

    const mine = await get(`/baskets/${basket.id}`, h.memberHeaders);
    const heads = await get(`/baskets/${basket.id}`, h.headHeaders);

    expect(mine.status).toBe(200);
    expect(mine.data.basket).toMatchObject({ id: basket.id, status: 'executing' });
    expect(mine.data.basket.items).toEqual([
      {
        id: item.id,
        brokerAccountId: h.account.id,
        instrumentId: h.instrument.id,
        tradingSymbol: 'NIFTYBEES',
        side: 'buy',
        quantity: 4,
        refPricePaise: null,
      },
    ]);
    expect(mine.data.orders).toEqual([
      {
        id: order?.id,
        basketItemId: item.id,
        status: 'partial',
        limitPricePaise: 10_050,
        filledQty: 2,
        avgFillPaise: 10_020,
        rejectReason: null,
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      },
    ]);
    expect(heads.status).toBe(200);
    expect(heads.data).toEqual(mine.data);
  });

  test('another member of the family gets 404', async () => {
    const h = await household();
    const basket = await h.propose();
    const third = await createUser();
    await addMember(h.family.id, third.id, 'spouse');

    const res = await get(`/baskets/${basket.id}`, await signIn(third.id));

    expect(res.status).toBe(404);
  });

  test('after the owner leaves, the head loses sight of it and the owner keeps it', async () => {
    const h = await household();
    const basket = await h.propose();
    await db
      .update(familyMembers)
      .set({ leftAt: new Date().toISOString(), leftReason: 'left' })
      .where(eq(familyMembers.id, h.membership.id));

    const heads = await get(`/baskets/${basket.id}`, h.headHeaders);
    const headsList = await get('/baskets?role=creator', h.headHeaders);
    const mine = await get(`/baskets/${basket.id}`, h.memberHeaders);
    const myList = await get('/baskets', h.memberHeaders);

    expect(heads.status).toBe(404);
    expect(headsList.data.items).toEqual([]);
    expect(mine.status).toBe(200);
    expect(ids(myList.data.items)).toEqual([basket.id]);
  });
});

describe('a member who left and was added again', () => {
  test('the head does not regain baskets from before the new membership; the owner keeps them', async () => {
    const h = await household();
    const old = await h.propose();
    await db
      .update(familyMembers)
      .set({ leftAt: sql`now()`, leftReason: 'left' })
      .where(eq(familyMembers.id, h.membership.id));
    await addMember(h.family.id, h.member.id, 'dependent_parent');
    const fresh = await h.propose();

    const heads = await get(`/baskets/${old.id}`, h.headHeaders);
    const headsList = await get('/baskets?role=creator', h.headHeaders);
    const mine = await get(`/baskets/${old.id}`, h.memberHeaders);

    expect(heads.status).toBe(404);
    expect(ids(headsList.data.items)).toEqual([fresh.id]);
    expect((await get(`/baskets/${fresh.id}`, h.headHeaders)).status).toBe(200);
    expect(mine.status).toBe(200);
  });
});

describe('GET /baskets', () => {
  test('pages newest first by cursor, without items', async () => {
    const h = await household();
    const newestFirst = ids([await h.propose(), await h.propose(), await h.propose()]).reverse();

    const first = await get('/baskets?limit=2', h.memberHeaders);
    const second = await get(`/baskets?limit=2&cursor=${first.data.nextCursor}`, h.memberHeaders);
    const asCreator = await get('/baskets?role=creator&limit=10', h.headHeaders);

    expect(ids(first.data.items)).toEqual(newestFirst.slice(0, 2));
    expect(first.data.items[0].items).toBeUndefined();
    expect(first.data.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(ids(second.data.items)).toEqual(newestFirst.slice(2));
    expect(second.data.nextCursor).toBeNull();
    expect(ids(asCreator.data.items)).toEqual(newestFirst);
  });

  test('filters by status', async () => {
    const h = await household();
    await h.propose();
    const rejected = await h.propose({ status: 'rejected' });

    const res = await get('/baskets?status=rejected', h.memberHeaders);

    expect(ids(res.data.items)).toEqual([rejected.id]);
  });

  test('the creator list shows nothing to someone who made nothing', async () => {
    const h = await household();
    await h.propose();

    const res = await get('/baskets?role=creator', h.memberHeaders);

    expect(res.data.items).toEqual([]);
  });

  test.each([
    ['an unknown role', '/baskets?role=viewer'],
    ['an unknown status', '/baskets?status=lost'],
    ['a forged cursor', `/baskets?cursor=${Buffer.from('{"at":"x","id":"y"}').toString('base64url')}`],
  ])('rejects %s with 400', async (_name, path) => {
    const res = await get(path, await signIn((await createUser()).id));

    expect(res.status).toBe(400);
  });
});
