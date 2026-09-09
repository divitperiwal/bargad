import { describe, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, baskets, families, familyMembers, grants, invites, jobs } from '#database/schema';
import { JobsRepository } from '#jobs/queue.repository';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { dissolveFamily } from '#modules/families/member/member.helper';
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
import { hashToken } from '#utils/security/crypto.util';

const send = async (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json, data: json.data };
};

// A head, one member with a broker account, a grant from the member to the head,
// and baskets in every state the cascade has to tell apart.
async function setup() {
  const head = await createUser();
  const member = await createUser();
  const { family, head: headRow } = await createFamily(head.id);
  const memberRow = await addMember(family.id, member.id, 'spouse');
  const account = await createBrokerAccount(member.id);
  const instrument = await createInstrument();
  const items = [{ brokerAccountId: account.id, instrumentId: instrument.id }];
  const grant = await createGrant({ familyId: family.id, grantorUserId: member.id, granteeUserId: head.id });
  const owned = { familyId: family.id, ownerUserId: member.id };
  const proposed = await createBasket({ ...owned, createdBy: head.id, mode: 'approval', status: 'proposed' }, items);
  const queued = await createBasket({ ...owned, createdBy: member.id, mode: 'self', status: 'queued' }, items);
  const done = await createBasket({ ...owned, createdBy: member.id, mode: 'self', status: 'done' }, items);
  return {
    head,
    member,
    family,
    headRow,
    memberRow,
    grant,
    proposed,
    queued,
    done,
    headHeaders: await signIn(head.id),
    memberHeaders: await signIn(member.id),
  };
}

const statusOf = async (id: string) =>
  (await db.select({ status: baskets.status }).from(baskets).where(eq(baskets.id, id)))[0]?.status;

const grantOf = async (id: string) => (await db.select().from(grants).where(eq(grants.id, id)))[0];

const auditFor = (action: string, familyId: string) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.familyId, familyId)));

const subjects = (rows: { subjectUserId: string }[]) => rows.map((row) => row.subjectUserId).sort();

describe('JobsRepository.enqueue', () => {
  test('ignores a second job with the same dedupe key', async () => {
    const dedupeKey = `test:${crypto.randomUUID()}`;

    await JobsRepository.enqueue({ kind: 'cancel_basket', payload: { basketId: 'a' }, dedupeKey }, db);
    await JobsRepository.enqueue({ kind: 'cancel_basket', payload: { basketId: 'a' }, dedupeKey }, db);

    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey))).toHaveLength(1);
  });
});

describe('leaving a family', () => {
  test('ends the membership and cascades to grants, baskets and jobs', async () => {
    const s = await setup();

    const res = await send('DELETE', '/families/current/members/me', undefined, s.memberHeaders);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ left: true });
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, s.memberRow.id));
    expect(row?.leftAt).not.toBeNull();
    expect(row?.leftReason).toBe('left');
    const grant = await grantOf(s.grant.id);
    expect(grant?.revokedAt).not.toBeNull();
    expect(grant?.revokeReason).toBe('left');
    expect(grant?.revokedBy).toBe(s.member.id);
    expect(await statusOf(s.proposed.id)).toBe('cancelled');
    expect(await statusOf(s.queued.id)).toBe('cancelled');
    expect(await statusOf(s.done.id)).toBe('done');
    const cancelJobs = await db
      .select()
      .from(jobs)
      .where(
        inArray(
          jobs.dedupeKey,
          [s.proposed.id, s.queued.id, s.done.id].map((id) => `cancel_basket:${id}`),
        ),
      );
    expect(cancelJobs).toHaveLength(1);
    expect(cancelJobs[0]).toMatchObject({ kind: 'cancel_basket', payload: { basketId: s.queued.id } });
    expect(subjects(await auditFor('member.left', s.family.id))).toEqual([s.head.id, s.member.id].sort());
  });

  test('removes the family from the member and the member from the head’s list', async () => {
    const s = await setup();
    await send('DELETE', '/families/current/members/me', undefined, s.memberHeaders);

    const mine = await send('GET', '/families/current', undefined, s.memberHeaders);
    const heads = await send('GET', '/families/current', undefined, s.headHeaders);

    expect(mine.status).toBe(404);
    expect(heads.data.members.map((m: { userId: string }) => m.userId)).toEqual([s.head.id]);
  });

  test('tells the head to hand over first', async () => {
    const s = await setup();

    const res = await send('DELETE', '/families/current/members/me', undefined, s.headHeaders);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('head_must_hand_over');
  });
});

describe('removing a member', () => {
  test('ends the membership with reason removed and cascades', async () => {
    const s = await setup();

    const res = await send('DELETE', `/families/current/members/${s.memberRow.id}`, undefined, s.headHeaders);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ removed: true });
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, s.memberRow.id));
    expect(row?.leftReason).toBe('removed');
    const grant = await grantOf(s.grant.id);
    expect(grant?.revokeReason).toBe('removed');
    expect(grant?.revokedBy).toBe(s.head.id);
    expect(await statusOf(s.proposed.id)).toBe('cancelled');
    expect(await statusOf(s.queued.id)).toBe('cancelled');
    expect(await statusOf(s.done.id)).toBe('done');
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, `cancel_basket:${s.queued.id}`));
    expect(job?.kind).toBe('cancel_basket');
    expect(subjects(await auditFor('member.removed', s.family.id))).toEqual([s.head.id, s.member.id].sort());
  });

  test('refuses a member who is not head', async () => {
    const s = await setup();

    const res = await send('DELETE', `/families/current/members/${s.headRow.id}`, undefined, s.memberHeaders);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_head');
  });

  test('answers 404 for a member of another family', async () => {
    const s = await setup();
    const other = await createFamily((await createUser()).id, 'Other');

    const res = await send('DELETE', `/families/current/members/${other.head.id}`, undefined, s.headHeaders);

    expect(res.status).toBe(404);
  });

  test('refuses to remove the head’s own row', async () => {
    const s = await setup();

    const res = await send('DELETE', `/families/current/members/${s.headRow.id}`, undefined, s.headHeaders);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('head_must_hand_over');
  });
});

describe('handover', () => {
  test('swaps the head, clears relationships, revokes grants and cancels every open basket', async () => {
    const s = await setup();
    const third = await createUser();
    await addMember(s.family.id, third.id, 'dependent_child');
    const queuedApproval = await createBasket({
      familyId: s.family.id,
      ownerUserId: s.member.id,
      createdBy: s.head.id,
      mode: 'approval',
      status: 'queued',
    });

    const res = await send('POST', '/families/current/handover', { toMemberId: s.memberRow.id }, s.headHeaders);

    expect(res.status).toBe(200);
    expect(res.data.me).toMatchObject({ role: 'member', relationship: null, canTrade: false });
    const byUser = Object.fromEntries(res.data.members.map((m: { userId: string }) => [m.userId, m]));
    expect(byUser[s.member.id]).toMatchObject({ role: 'head', relationship: 'self' });
    expect(byUser[third.id]).toMatchObject({ role: 'member', relationship: null });
    expect((await grantOf(s.grant.id))?.revokeReason).toBe('handover');
    expect(await statusOf(s.proposed.id)).toBe('cancelled');
    // Trading pauses until each member re-declares, so even self baskets stop.
    expect(await statusOf(s.queued.id)).toBe('cancelled');
    expect(await statusOf(queuedApproval.id)).toBe('cancelled');
    expect(await statusOf(s.done.id)).toBe('done');
    const cancelJobs = await db
      .select()
      .from(jobs)
      .where(inArray(jobs.dedupeKey, [`cancel_basket:${queuedApproval.id}`, `cancel_basket:${s.queued.id}`]));
    expect(cancelJobs).toHaveLength(2);
    expect(subjects(await auditFor('family.handover', s.family.id))).toEqual([s.head.id, s.member.id, third.id].sort());
  });

  test('revokes invites the old head sent', async () => {
    const s = await setup();
    const token = await pendingInvite(s.family.id, s.head.id);

    await send('POST', '/families/current/handover', { toMemberId: s.memberRow.id }, s.headHeaders);

    const preview = await send('GET', `/invites/${token}`, undefined);
    expect(preview.status).toBe(404);
    expect(preview.body.code).toBe('invite_invalid');
  });

  test('refuses a non-head, an unknown member and the head’s own row', async () => {
    const s = await setup();

    const notHead = await send('POST', '/families/current/handover', { toMemberId: s.headRow.id }, s.memberHeaders);
    const unknown = await send(
      'POST',
      '/families/current/handover',
      { toMemberId: crypto.randomUUID() },
      s.headHeaders,
    );
    const self = await send('POST', '/families/current/handover', { toMemberId: s.headRow.id }, s.headHeaders);

    expect(notHead.status).toBe(403);
    expect(unknown.status).toBe(404);
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('invalid_request');
  });
});

describe('declaring a relationship', () => {
  test('lets a member declare once after a handover, and not twice', async () => {
    const s = await setup();
    await send('POST', '/families/current/handover', { toMemberId: s.memberRow.id }, s.headHeaders);

    const first = await send('PATCH', '/families/current/members/me', { relationship: 'spouse' }, s.headHeaders);
    const second = await send('PATCH', '/families/current/members/me', { relationship: 'other' }, s.headHeaders);

    expect(first.status).toBe(200);
    expect(first.data.me).toMatchObject({ relationship: 'spouse', canTrade: true });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('relationship_already_declared');
    expect(subjects(await auditFor('member.relationship_declared', s.family.id))).toEqual(
      [s.head.id, s.member.id].sort(),
    );
  });
});

describe('dissolving a family', () => {
  test('lets a head alone dissolve it and start another', async () => {
    const head = await createUser();
    const { family } = await createFamily(head.id);
    const headers = await signIn(head.id);

    const res = await send('DELETE', '/families/current', undefined, headers);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ dissolved: true });
    const [row] = await db.select().from(families).where(eq(families.id, family.id));
    expect(row?.dissolvedAt).not.toBeNull();
    expect((await send('GET', '/families/current', undefined, headers)).status).toBe(404);
    expect((await send('POST', '/families', { name: 'Again' }, headers)).status).toBe(201);
    expect(await auditFor('family.dissolved', family.id)).toHaveLength(1);
  });

  test('refuses while another member is active', async () => {
    const s = await setup();

    const res = await send('DELETE', '/families/current', undefined, s.headHeaders);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('family_has_members');
  });
});

describe('concurrent changes', () => {
  test('promoting a member who already left changes nothing, so the old head stays head', async () => {
    const s = await setup();
    await db
      .update(familyMembers)
      .set({ leftAt: new Date().toISOString(), leftReason: 'left' })
      .where(eq(familyMembers.id, s.memberRow.id));

    const promoted = await FamilyRepository.promote(s.memberRow.id, db);

    expect(promoted).toBeUndefined();
    const [head] = await db.select().from(familyMembers).where(eq(familyMembers.id, s.headRow.id));
    expect(head?.role).toBe('head');
  });

  test('two simultaneous leaves give one 200 and one audit row', async () => {
    const s = await setup();

    const results = await Promise.all([
      send('DELETE', '/families/current/members/me', undefined, s.memberHeaders),
      send('DELETE', '/families/current/members/me', undefined, s.memberHeaders),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200)).toHaveLength(1);
    const audit = await auditFor('member.left', s.family.id);
    expect(audit.filter((a) => a.subjectUserId === s.member.id)).toHaveLength(1);
  });
});

async function pendingInvite(familyId: string, invitedBy: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.insert(invites).values({
    familyId,
    invitedBy,
    email: 'mum@example.com',
    relationship: 'dependent_parent',
    tokenHash: hashToken(token),
  });
  return token;
}

describe('invites of a dissolved family', () => {
  test('stop working once the head dissolves the family', async () => {
    const head = await createUser();
    const { family } = await createFamily(head.id);
    const token = await pendingInvite(family.id, head.id);
    await send('DELETE', '/families/current', undefined, await signIn(head.id));

    const preview = await send('GET', `/invites/${token}`, undefined);
    const accept = await send('POST', `/invites/${token}/acceptance`, undefined, await signIn((await createUser()).id));

    expect(preview.status).toBe(404);
    expect(preview.body.code).toBe('invite_invalid');
    expect(accept.status).toBe(404);
    expect(accept.body.code).toBe('invite_invalid');
  });

  test('an acceptance racing a dissolve waits for it and then finds the invite invalid', async () => {
    const head = await createUser();
    const { family } = await createFamily(head.id);
    const token = await pendingInvite(family.id, head.id);
    const mum = await createUser({ email: 'mum@example.com' });
    const mumHeaders = await signIn(mum.id);
    let accepting: ReturnType<typeof send> | undefined;

    // A dissolve that has taken the family lock; the acceptance starts while it is held.
    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from families where id = ${family.id} for no key update`);
      accepting = send('POST', `/invites/${token}/acceptance`, undefined, mumHeaders);
      await Bun.sleep(300);
      await dissolveFamily(tx, family.id, head.id);
    });
    const accept = await accepting;

    expect(accept?.status).toBe(404);
    expect(accept?.body.code).toBe('invite_invalid');
    expect(await db.select().from(familyMembers).where(eq(familyMembers.userId, mum.id))).toEqual([]);
  });

  test('are ignored even if still pending in a dissolved family', async () => {
    const head = await createUser();
    const { family } = await createFamily(head.id);
    const token = await pendingInvite(family.id, head.id);
    await db.update(families).set({ dissolvedAt: new Date().toISOString() }).where(eq(families.id, family.id));

    const preview = await send('GET', `/invites/${token}`, undefined);

    expect(preview.status).toBe(404);
  });
});
