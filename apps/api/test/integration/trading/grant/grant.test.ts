import { describe, expect, spyOn, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, baskets, familyMembers, grants, jobs } from '#database/schema';
import { PasskeyService } from '#modules/accounts/passkey/passkey.service';
import {
  addMember,
  createBasket,
  createBrokerAccount,
  createFamily,
  createGrant,
  createInstrument,
  createUser,
  signIn,
} from '#test/integration/fixtures';
import { registerPasskey, signStepUp } from '#test/integration/webauthn';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, data: json.data, code: json.code as string | undefined };
};

// A head and a spouse member who has a passkey and can grant.
async function household() {
  const head = await createUser();
  const { family } = await createFamily(head.id);
  const member = await createUser();
  const membership = await addMember(family.id, member.id, 'spouse');
  const memberHeaders = await signIn(member.id);
  const { authenticator } = await registerPasskey(memberHeaders);
  return { head, family, member, membership, memberHeaders, authenticator };
}

type Household = Awaited<ReturnType<typeof household>>;

const caps = { durationMinutes: 24 * 60, buyCapPaise: 500_000, sellCapPaise: 200_000, perOrderCapPaise: 100_000 };

const createGrantAs = async (h: Household, body: Record<string, unknown> = {}, targetId = h.head.id) =>
  send('POST', '/grants', h.memberHeaders, {
    ...caps,
    ...body,
    assertion: await signStepUp(h.memberHeaders, h.authenticator, 'grant', targetId),
  });

describe('POST /grants', () => {
  test('a spouse grants the head 24 hours: active, nothing spent, audited for both', async () => {
    const h = await household();

    const res = await createGrantAs(h);

    expect(res.status).toBe(201);
    expect(res.data.grant).toMatchObject({
      familyId: h.family.id,
      grantorUserId: h.member.id,
      granteeUserId: h.head.id,
      brokerAccountId: null,
      allowedInstrumentIds: null,
      buyCapPaise: 500_000,
      sellCapPaise: 200_000,
      perOrderCapPaise: 100_000,
      buySpentPaise: 0,
      sellSpentPaise: 0,
      revokedAt: null,
      revokeReason: null,
      status: 'active',
    });
    expect(res.data.grant.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const lifetime = Date.parse(res.data.grant.expiresAt) - Date.parse(res.data.grant.startsAt);
    expect(lifetime).toBe(24 * 60 * 60_000);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'grant.created'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([h.head.id, h.member.id].sort());
    expect(audits[0]).toMatchObject({
      actorUserId: h.member.id,
      familyId: h.family.id,
      targetType: 'grant',
      targetId: res.data.grant.id,
      detail: {
        buyCapPaise: 500_000,
        sellCapPaise: 200_000,
        perOrderCapPaise: 100_000,
        expiresAt: res.data.grant.expiresAt,
      },
    });
  });

  // Shaped like an assertion but never signed: these refusals must come before the passkey check.
  const unsigned = {
    challengeId: crypto.randomUUID(),
    response: { id: 'x', rawId: 'x', type: 'public-key', response: {} },
  };

  test('the head gets 409 head_cannot_grant', async () => {
    const h = await household();

    const res = await send('POST', '/grants', await signIn(h.head.id), { ...caps, assertion: unsigned });

    expect(res.status).toBe(409);
    expect(res.code).toBe('head_cannot_grant');
  });

  test('a member whose relationship is other gets 403 cannot_trade', async () => {
    const h = await household();
    const cousin = await createUser();
    await addMember(h.family.id, cousin.id, 'other');

    const res = await send('POST', '/grants', await signIn(cousin.id), { ...caps, assertion: unsigned });

    expect(res.status).toBe(403);
    expect(res.code).toBe('cannot_trade');
  });

  test('an assertion signed for someone other than the head gets 403 passkey_failed and creates nothing', async () => {
    const h = await household();

    const res = await createGrantAs(h, {}, h.member.id);

    expect(res.status).toBe(403);
    expect(res.code).toBe('passkey_failed');
    expect(await db.select().from(grants)).toEqual([]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'grant.created'))).toEqual([]);
  });

  test.each<[string, Record<string, unknown>]>([
    ['59 minutes', { durationMinutes: 59 }],
    ['10081 minutes', { durationMinutes: 10081 }],
    ['a zero per-order cap', { perOrderCapPaise: 0 }],
    ['a negative buy cap', { buyCapPaise: -1 }],
    ['a fractional buy cap', { buyCapPaise: 1.5 }],
    ['a buy cap past the safe integer range', { buyCapPaise: 2 ** 60 }],
  ])('rejects %s with 400', async (_name, change) => {
    const h = await household();

    const res = await createGrantAs(h, change);

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_request');
  });

  test("someone else's broker account gets 400 invalid_account", async () => {
    const h = await household();
    const headAccount = await createBrokerAccount(h.head.id);

    const res = await createGrantAs(h, { brokerAccountId: headAccount.id });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_account');
  });

  test('an unknown allowed instrument gets 400 invalid_instrument', async () => {
    const h = await household();

    const res = await createGrantAs(h, { allowedInstrumentIds: [crypto.randomUUID()] });

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_instrument');
  });

  test('a grant limited to an own account and listed instruments stores both', async () => {
    const h = await household();
    const account = await createBrokerAccount(h.member.id);
    const instrument = await createInstrument();

    const res = await createGrantAs(h, { brokerAccountId: account.id, allowedInstrumentIds: [instrument.id] });

    expect(res.status).toBe(201);
    expect(res.data.grant).toMatchObject({ brokerAccountId: account.id, allowedInstrumentIds: [instrument.id] });
  });

  // A leave or handover that commits while the grantor is signing must not leave an unrevoked grant behind.
  describe('when the family changes after the passkey check', () => {
    const changeAfterStepUp = (change: () => Promise<unknown>) => {
      const original = PasskeyService.verifyStepUp;
      return spyOn(PasskeyService, 'verifyStepUp').mockImplementation(async (input) => {
        const result = await original(input);
        await change();
        return result;
      });
    };

    test.each<[string, (h: Household) => Promise<unknown>]>([
      [
        'the grantor became view-only',
        (h) => db.update(familyMembers).set({ relationship: 'other' }).where(eq(familyMembers.id, h.membership.id)),
      ],
      [
        'the grantor left',
        (h) =>
          db
            .update(familyMembers)
            .set({ leftAt: sql`now()`, leftReason: 'left' })
            .where(eq(familyMembers.id, h.membership.id)),
      ],
      [
        'the head changed',
        async (h) => {
          const next = await createUser();
          await db
            .update(familyMembers)
            .set({ role: 'member', relationship: null })
            .where(eq(familyMembers.userId, h.head.id));
          await db
            .insert(familyMembers)
            .values({ familyId: h.family.id, userId: next.id, role: 'head', relationship: 'self' });
        },
      ],
    ])('refuses with 409 conflict and creates nothing when %s', async (_name, change) => {
      const h = await household();
      const spy = changeAfterStepUp(() => change(h));

      try {
        const res = await createGrantAs(h);

        expect(res.status).toBe(409);
        expect(res.code).toBe('conflict');
      } finally {
        spy.mockRestore();
      }
      expect(await db.select().from(grants)).toEqual([]);
      expect(await db.select().from(auditLog).where(eq(auditLog.action, 'grant.created'))).toEqual([]);
    });
  });

  test('a user with no family gets 404 not_in_family', async () => {
    const loner = await createUser();

    const res = await send('POST', '/grants', await signIn(loner.id), { ...caps, assertion: unsigned });

    expect(res.status).toBe(404);
    expect(res.code).toBe('not_in_family');
  });
});

const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60_000).toISOString();

const idsOf = (items: { id: string }[]) => items.map((item) => item.id).sort();

describe('GET /grants', () => {
  test('the grantor sees their grant and the head sees it as grantee', async () => {
    const h = await household();
    const grant = await createGrant({ familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id });

    const asGrantor = await send('GET', '/grants', h.memberHeaders);
    const asGrantee = await send('GET', '/grants?role=grantee', await signIn(h.head.id));

    expect(asGrantor.status).toBe(200);
    expect(idsOf(asGrantor.data.items)).toEqual([grant.id]);
    expect(asGrantor.data.items[0]).toMatchObject({
      status: 'active',
      expiresAt: new Date(grant.expiresAt).toISOString(),
    });
    expect(idsOf(asGrantee.data.items)).toEqual([grant.id]);
    expect(idsOf((await send('GET', '/grants?role=grantee', h.memberHeaders)).data.items)).toEqual([]);
  });

  test('active=true drops revoked and expired grants', async () => {
    const h = await household();
    const parties = { familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id };
    const live = await createGrant(parties);
    const revoked = await createGrant({ ...parties, revokedAt: hoursAgo(1), revokeReason: 'member' });
    const expired = await createGrant({ ...parties, startsAt: hoursAgo(4), expiresAt: hoursAgo(2) });

    const all = await send('GET', '/grants?active=false', h.memberHeaders);
    const active = await send('GET', '/grants?active=true', h.memberHeaders);

    expect(idsOf(all.data.items)).toEqual([live.id, revoked.id, expired.id].sort());
    const statuses = Object.fromEntries(all.data.items.map((g: { id: string; status: string }) => [g.id, g.status]));
    expect(statuses).toEqual({ [live.id]: 'active', [revoked.id]: 'revoked', [expired.id]: 'expired' });
    expect(idsOf(active.data.items)).toEqual([live.id]);
  });

  test('the head no longer sees a grant once its grantor has left the family', async () => {
    const h = await household();
    await createGrant({ familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id });
    await db
      .update(familyMembers)
      .set({ leftAt: sql`now()`, leftReason: 'left' })
      .where(eq(familyMembers.id, h.membership.id));

    const res = await send('GET', '/grants?role=grantee', await signIn(h.head.id));

    expect(res.status).toBe(200);
    expect(res.data.items).toEqual([]);
  });
});

describe('GET /grants after the grantor rejoins', () => {
  test('the head does not regain grants from before the new membership', async () => {
    const h = await household();
    const parties = { familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id };
    await createGrant(parties);
    await db
      .update(familyMembers)
      .set({ leftAt: sql`now()`, leftReason: 'left' })
      .where(eq(familyMembers.id, h.membership.id));
    await addMember(h.family.id, h.member.id, 'spouse');
    const fresh = await createGrant(parties);

    const res = await send('GET', '/grants?role=grantee', await signIn(h.head.id));

    expect(idsOf(res.data.items)).toEqual([fresh.id]);
  });
});

describe('DELETE /grants/:id', () => {
  const revokeAudits = () => db.select().from(auditLog).where(eq(auditLog.action, 'grant.revoked'));

  test('the grantor revokes: status revoked, reason member, audited for both', async () => {
    const h = await household();
    const grant = await createGrant({ familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id });

    const res = await send('DELETE', `/grants/${grant.id}`, h.memberHeaders);

    expect(res.status).toBe(200);
    expect(res.data.grant).toMatchObject({ id: grant.id, status: 'revoked', revokeReason: 'member' });
    expect(res.data.grant.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const [row] = await db.select().from(grants).where(eq(grants.id, grant.id));
    expect(row?.revokedBy).toBe(h.member.id);
    const audits = await revokeAudits();
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([h.head.id, h.member.id].sort());
    expect(audits[0]).toMatchObject({ actorUserId: h.member.id, targetType: 'grant', targetId: grant.id });
  });

  test('revoking again returns the unchanged grant and writes no second audit', async () => {
    const h = await household();
    const grant = await createGrant({ familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id });
    const first = await send('DELETE', `/grants/${grant.id}`, h.memberHeaders);

    const again = await send('DELETE', `/grants/${grant.id}`, h.memberHeaders);

    expect(again.status).toBe(200);
    expect(again.data.grant).toEqual(first.data.grant);
    expect(await revokeAudits()).toHaveLength(2);
  });

  test('the head gets 404 and the grant stays active', async () => {
    const h = await household();
    const grant = await createGrant({ familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id });

    const res = await send('DELETE', `/grants/${grant.id}`, await signIn(h.head.id));

    expect(res.status).toBe(404);
    const [row] = await db.select().from(grants).where(eq(grants.id, grant.id));
    expect(row?.revokedAt).toBeNull();
  });

  test('an unknown grant gets 404', async () => {
    const h = await household();

    const res = await send('DELETE', `/grants/${crypto.randomUUID()}`, h.memberHeaders);

    expect(res.status).toBe(404);
  });

  test("revoking cancels the grant's open baskets and tells the engine once", async () => {
    const h = await household();
    const parties = { familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id };
    const grant = await createGrant(parties);
    const otherGrant = await createGrant(parties);
    const items = [
      { brokerAccountId: (await createBrokerAccount(h.member.id)).id, instrumentId: (await createInstrument()).id },
    ];
    const basketOf = (grantId: string) =>
      createBasket(
        {
          familyId: h.family.id,
          ownerUserId: h.member.id,
          createdBy: h.head.id,
          mode: 'grant',
          grantId,
          status: 'queued',
        },
        items,
      );
    const mine = await basketOf(grant.id);
    const theirs = await basketOf(otherGrant.id);

    const first = await send('DELETE', `/grants/${grant.id}`, h.memberHeaders);
    const again = await send('DELETE', `/grants/${grant.id}`, h.memberHeaders);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    const statusOf = async (id: string) => (await db.select().from(baskets).where(eq(baskets.id, id)))[0]?.status;
    expect(await statusOf(mine.id)).toBe('cancelled');
    expect(await statusOf(theirs.id)).toBe('queued');
    const cancelJobs = await db.select().from(jobs).where(eq(jobs.kind, 'cancel_basket'));
    expect(cancelJobs).toHaveLength(1);
    expect(cancelJobs[0]?.payload).toEqual({ basketId: mine.id });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'basket.cancelled'));
    expect(audits.map((a) => a.subjectUserId).sort()).toEqual([h.head.id, h.member.id].sort());
    expect(audits[0]).toMatchObject({ actorUserId: h.member.id, targetId: mine.id });
  });

  test('an admin revokes with reason admin', async () => {
    const h = await household();
    const grant = await createGrant({ familyId: h.family.id, grantorUserId: h.member.id, granteeUserId: h.head.id });
    const admin = await createUser({ isAdmin: true });

    const res = await send('DELETE', `/grants/${grant.id}`, await signIn(admin.id));

    expect(res.status).toBe(200);
    expect(res.data.grant).toMatchObject({ status: 'revoked', revokeReason: 'admin' });
    const [row] = await db.select().from(grants).where(eq(grants.id, grant.id));
    expect(row?.revokedBy).toBe(admin.id);
    expect((await revokeAudits())[0]).toMatchObject({ actorUserId: admin.id });
  });
});
