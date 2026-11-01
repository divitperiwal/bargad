import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { brokerAccounts, dailyValuations, familyMembers, ledgerEntries } from '#database/schema';
import {
  addMember,
  createBrokerAccount,
  createFamily,
  createHolding,
  createInstrument,
  createLedgerEntry,
  createUser,
  signIn,
} from '#test/integration/fixtures';

const get = async (path: string, userId: string) => {
  const res = await app.request(path, { headers: await signIn(userId) });
  const json = await res.json();
  return { status: res.status, data: json.data };
};

// An account whose holdings cost exactly `costPaise`.
const accountWithHoldings = async (userId: string, costPaise: number, hidden = false, label = 'Account') => {
  const account = await createBrokerAccount(userId, { hidden, label });
  await createHolding(account.id, (await createInstrument()).id, 10, costPaise / 10);
  return account;
};

// Rohan heads the family; Priya (spouse) and Anil (dependent parent) are members.
// Priya has a visible 1,00,000 account, a hidden 50,000 account, a visible 20,000 FD and a hidden 5,000 loan.
async function arrange() {
  const rohan = await createUser({ displayName: 'Rohan' });
  const priya = await createUser({ displayName: 'Priya' });
  const anil = await createUser({ displayName: 'Anil' });
  const { family } = await createFamily(rohan.id);
  await addMember(family.id, priya.id, 'spouse');
  await addMember(family.id, anil.id, 'dependent_parent');
  const visibleAccount = await accountWithHoldings(priya.id, 100_000, false, 'Visible');
  const hiddenAccount = await accountWithHoldings(priya.id, 50_000, true, 'Hidden');
  const fd = await createLedgerEntry(priya.id, { type: 'fd', name: 'FD', valuePaise: 20_000 });
  const loan = await createLedgerEntry(priya.id, {
    kind: 'liability',
    type: 'home_loan',
    name: 'Loan',
    valuePaise: 5_000,
    hidden: true,
  });
  return { rohan, priya, anil, family, visibleAccount, hiddenAccount, fd, loan };
}

type Member = { userId: string; visible: boolean; subtotal?: Record<string, number>; role: string };
const memberOf = (data: { members: Member[] }, userId: string) => data.members.find((m) => m.userId === userId);

describe('GET /household', () => {
  test('a user with no family gets a solo view of their own holdings and ledger', async () => {
    const user = await createUser({ displayName: 'Solo' });
    await accountWithHoldings(user.id, 30_000);
    await createLedgerEntry(user.id, { valuePaise: 4_000, hidden: true });
    await createLedgerEntry(user.id, { kind: 'liability', type: 'credit_card', valuePaise: 1_000 });

    const { status, data } = await get('/household', user.id);

    const expected = {
      brokerValuePaise: 30_000,
      investedPaise: 30_000,
      assetsPaise: 4_000,
      liabilitiesPaise: 1_000,
      netWorthPaise: 33_000,
    };
    expect(status).toBe(200);
    expect(data.scope).toBe('solo');
    expect(data.totals).toEqual(expected);
    expect(data.members).toEqual([
      { userId: user.id, displayName: 'Solo', role: 'head', relationship: 'self', visible: true, subtotal: expected },
    ]);
  });

  test('a member sees their own hidden items and nothing about the others', async () => {
    const { rohan, priya } = await arrange();

    const { data } = await get('/household', priya.id);

    expect(data.scope).toBe('family');
    expect(memberOf(data, priya.id)?.subtotal).toEqual({
      brokerValuePaise: 150_000,
      investedPaise: 150_000,
      assetsPaise: 20_000,
      liabilitiesPaise: 5_000,
      netWorthPaise: 165_000,
    });
    const rohanView = memberOf(data, rohan.id);
    expect(rohanView?.visible).toBe(false);
    expect(rohanView).not.toHaveProperty('subtotal');
  });

  test('the head sees every member and totals that leave out hidden items', async () => {
    const { rohan, priya, anil } = await arrange();

    const { data } = await get('/household', rohan.id);

    expect(memberOf(data, priya.id)).toMatchObject({
      visible: true,
      subtotal: { brokerValuePaise: 100_000, assetsPaise: 20_000, liabilitiesPaise: 0 },
    });
    expect(memberOf(data, anil.id)?.visible).toBe(true);
    expect(data.totals).toMatchObject({ brokerValuePaise: 100_000, assetsPaise: 20_000, liabilitiesPaise: 0 });
  });

  test("hidden items are in nobody's totals but the owner's, so no total can be subtracted to reveal them", async () => {
    const { rohan, anil, priya } = await arrange();

    const head = (await get('/household', rohan.id)).data;
    const parent = (await get('/household', anil.id)).data;
    const owner = (await get('/household', priya.id)).data;

    expect(parent.totals).toEqual(head.totals);
    expect(parent.members.every((m: Member) => m.userId === anil.id || m.visible === false)).toBe(true);
    expect(owner.totals.brokerValuePaise).toBe(150_000);
    expect(head.totals.brokerValuePaise).toBe(100_000);
  });

  test('uses the latest daily valuation instead of cost and reports its day', async () => {
    const { rohan, priya, visibleAccount } = await arrange();
    await db.insert(dailyValuations).values([
      { brokerAccountId: visibleAccount.id, day: '2026-11-10', marketValuePaise: 1, investedPaise: 1 },
      { brokerAccountId: visibleAccount.id, day: '2026-11-12', marketValuePaise: 130_000, investedPaise: 100_000 },
    ]);

    const household = (await get('/household', rohan.id)).data;
    const detail = (await get(`/household/members/${priya.id}`, rohan.id)).data;

    expect(memberOf(household, priya.id)?.subtotal).toMatchObject({
      brokerValuePaise: 130_000,
      investedPaise: 100_000,
    });
    expect(detail.accounts[0]).toMatchObject({
      marketValuePaise: 130_000,
      investedPaise: 100_000,
      valuedOn: '2026-11-12',
    });
  });

  test('closed accounts and deleted entries never count', async () => {
    const user = await createUser();
    const closed = await accountWithHoldings(user.id, 9_000);
    await db.update(brokerAccounts).set({ status: 'closed' }).where(eq(brokerAccounts.id, closed.id));
    const gone = await createLedgerEntry(user.id, { valuePaise: 8_000 });
    await db.update(ledgerEntries).set({ deletedAt: new Date().toISOString() }).where(eq(ledgerEntries.id, gone.id));

    const { data } = await get('/household', user.id);

    expect(data.totals.netWorthPaise).toBe(0);
  });
});

describe('GET /household/members/:userId', () => {
  test('the head sees only the visible account and entry', async () => {
    const { rohan, priya, visibleAccount, fd } = await arrange();

    const { status, data } = await get(`/household/members/${priya.id}`, rohan.id);

    expect(status).toBe(200);
    expect(data.member).toEqual({ userId: priya.id, displayName: 'Priya' });
    expect(data.accounts.map((a: { id: string }) => a.id)).toEqual([visibleAccount.id]);
    expect(data.accounts[0].valuedOn).toBeNull();
    expect(data.accounts[0].holdings[0]).toMatchObject({ quantity: 10, avgCostPaise: 10_000 });
    expect(data.accounts[0].holdings[0]).toHaveProperty('tradingSymbol');
    expect(data.ledgerEntries.map((e: { id: string }) => e.id)).toEqual([fd.id]);
  });

  test('the owner sees all four with their hidden flags', async () => {
    const { priya } = await arrange();

    const { data } = await get(`/household/members/${priya.id}`, priya.id);

    expect(data.accounts.map((a: { hidden: boolean }) => a.hidden).sort()).toEqual([false, true]);
    expect(data.ledgerEntries.map((e: { hidden: boolean }) => e.hidden).sort()).toEqual([false, true]);
  });

  test('another member gets 404', async () => {
    const { anil, priya } = await arrange();

    const { status } = await get(`/household/members/${priya.id}`, anil.id);

    expect(status).toBe(404);
  });

  test('a former member is gone from the head view and answers 404', async () => {
    const { rohan, priya } = await arrange();
    await db
      .update(familyMembers)
      .set({ leftAt: new Date().toISOString(), leftReason: 'left' })
      .where(eq(familyMembers.userId, priya.id));

    const detail = await get(`/household/members/${priya.id}`, rohan.id);
    const household = await get('/household', rohan.id);

    expect(detail.status).toBe(404);
    expect(memberOf(household.data, priya.id)).toBeUndefined();
  });
});
