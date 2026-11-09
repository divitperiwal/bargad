import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, baskets, familyMembers, grants, jobs } from '#database/schema';
import {
  addMember,
  createBrokerAccount,
  createFamily,
  createGrant,
  createInstrument,
  createUser,
  signIn,
} from '#test/integration/fixtures';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, data: json.data, code: json.code as string | undefined };
};

const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60_000).toISOString();

// A head and a spouse member with two accounts and an instrument; the grant fields go to the fixture.
async function granted(fields: Partial<Parameters<typeof createGrant>[0]> = {}) {
  const head = await createUser();
  const { family } = await createFamily(head.id);
  const member = await createUser();
  const membership = await addMember(family.id, member.id, 'spouse');
  const accounts = [await createBrokerAccount(member.id), await createBrokerAccount(member.id)];
  const instrument = await createInstrument();
  const grant = await createGrant({ familyId: family.id, grantorUserId: member.id, granteeUserId: head.id, ...fields });
  return { head, family, member, membership, accounts, instrument, grant, headers: await signIn(head.id) };
}

type Granted = Awaited<ReturnType<typeof granted>>;

const item = (brokerAccountId: string, instrumentId: string) => ({
  brokerAccountId,
  instrumentId,
  side: 'buy',
  quantity: 10,
});

const place = (g: Granted, body: Record<string, unknown> = {}) =>
  send('POST', '/baskets', g.headers, {
    ownerUserId: g.member.id,
    mode: 'grant',
    grantId: g.grant.id,
    items: g.accounts.map((account) => item(account.id, g.instrument.id)),
    ...body,
  });

describe('POST /baskets (grant)', () => {
  test('the head places a basket under a grant: queued, one job per account, audited for both', async () => {
    const g = await granted();

    const res = await place(g);

    expect(res.status).toBe(201);
    expect(res.data.basket).toMatchObject({
      familyId: g.family.id,
      ownerUserId: g.member.id,
      createdBy: g.head.id,
      mode: 'grant',
      grantId: g.grant.id,
      status: 'queued',
      approvedAt: null,
    });
    expect(res.data.basket.items).toHaveLength(2);
    const queued = await db.select().from(jobs);
    expect(queued.map((j) => j.lane).sort()).toEqual(g.accounts.map((a) => a.id).sort());
    expect(queued.every((j) => j.kind === 'execute_basket')).toBe(true);
    expect(queued.find((j) => j.lane === g.accounts[0]?.id)?.dedupeKey).toBe(
      `execute_basket:${res.data.basket.id}:${g.accounts[0]?.id}:0`,
    );
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.placed_under_grant'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([g.head.id, g.member.id].sort());
    expect(audits[0]).toMatchObject({
      actorUserId: g.head.id,
      targetId: res.data.basket.id,
      detail: { grantId: g.grant.id, itemCount: 2 },
    });
  });

  const expectNothingPlaced = async () => {
    expect(await db.select().from(baskets)).toEqual([]);
    expect(await db.select().from(jobs)).toEqual([]);
  };

  test.each<[string, Partial<Parameters<typeof createGrant>[0]>]>([
    ['a revoked grant', { revokedAt: hoursAgo(1), revokeReason: 'member' }],
    ['an expired grant', { startsAt: hoursAgo(4), expiresAt: hoursAgo(2) }],
  ])('%s gets 409 grant_inactive and places nothing', async (_name, fields) => {
    const g = await granted(fields);

    const res = await place(g);

    expect(res.status).toBe(409);
    expect(res.code).toBe('grant_inactive');
    await expectNothingPlaced();
  });

  test("another member's grant gets 404 grant_not_found", async () => {
    const g = await granted();
    const sibling = await createUser();
    await addMember(g.family.id, sibling.id, 'spouse');
    const theirs = await createGrant({ familyId: g.family.id, grantorUserId: sibling.id, granteeUserId: g.head.id });

    const res = await place(g, { grantId: theirs.id });

    expect(res.status).toBe(404);
    expect(res.code).toBe('grant_not_found');
    await expectNothingPlaced();
  });

  test('an owner who is not the grantor gets 404 grant_not_found', async () => {
    const g = await granted();
    const sibling = await createUser();
    await addMember(g.family.id, sibling.id, 'spouse');
    const account = await createBrokerAccount(sibling.id);

    const res = await place(g, { ownerUserId: sibling.id, items: [item(account.id, g.instrument.id)] });

    expect(res.status).toBe(404);
    expect(res.code).toBe('grant_not_found');
    await expectNothingPlaced();
  });
  test('a grant limited to one account gets 400 outside_grant for an item on another', async () => {
    const g = await granted();
    const [accountA, accountB] = g.accounts;
    if (!accountA || !accountB) throw new Error('fixture made two accounts');
    await db.update(grants).set({ brokerAccountId: accountA.id }).where(eq(grants.id, g.grant.id));

    const res = await place(g, { items: [item(accountA.id, g.instrument.id), item(accountB.id, g.instrument.id)] });

    expect(res.status).toBe(400);
    expect(res.code).toBe('outside_grant');
    await expectNothingPlaced();
  });

  test("an allow-list without the item's instrument gets 400 outside_grant", async () => {
    const allowed = await createInstrument();
    const g = await granted({ allowedInstrumentIds: [allowed.id] });

    const res = await place(g);

    expect(res.status).toBe(400);
    expect(res.code).toBe('outside_grant');
    await expectNothingPlaced();
  });

  test('items inside both limits are placed', async () => {
    const allowed = await createInstrument();
    const g = await granted({ allowedInstrumentIds: [allowed.id] });
    const [accountA] = g.accounts;
    if (!accountA) throw new Error('fixture made two accounts');
    await db.update(grants).set({ brokerAccountId: accountA.id }).where(eq(grants.id, g.grant.id));

    const res = await place(g, { items: [item(accountA.id, allowed.id)] });

    expect(res.status).toBe(201);
  });
  test('grant mode without a grant id gets 400', async () => {
    const g = await granted();

    const res = await place(g, { grantId: undefined });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_request');
  });

  test('approval mode with a grant id gets 400', async () => {
    const g = await granted();

    const res = await place(g, { mode: 'approval' });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_request');
  });

  test("after a handover resets the grantor's relationship, the old grant gets 409 grant_inactive", async () => {
    const g = await granted();
    await db.update(familyMembers).set({ relationship: null }).where(eq(familyMembers.id, g.membership.id));

    const res = await place(g);

    expect(res.status).toBe(409);
    expect(res.code).toBe('grant_inactive');
    await expectNothingPlaced();
  });

  test('a grantee who no longer heads the family gets 409 grant_inactive', async () => {
    const g = await granted();
    await db
      .update(familyMembers)
      .set({ role: 'member', relationship: null })
      .where(eq(familyMembers.userId, g.head.id));

    const res = await place(g);

    expect(res.status).toBe(409);
    expect(res.code).toBe('grant_inactive');
    await expectNothingPlaced();
  });
});
