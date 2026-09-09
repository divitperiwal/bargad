import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, brokerAccounts, brokerSecrets, familyMembers, invites } from '#database/schema';
import {
  addMember,
  captureMail,
  createBrokerAccount,
  createBrokerSecret,
  createFamily,
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

const DAY_MS = 24 * 60 * 60 * 1000;

// An invite that expired two days ago. Both times come from one instant, so the row stays inside
// the CHECK expires_at <= created_at + 7 days, and it is expired by any clock, the database's included.
const expiredDates = () => {
  const now = Date.now();
  return { createdAt: new Date(now - 8 * DAY_MS).toISOString(), expiresAt: new Date(now - 2 * DAY_MS).toISOString() };
};

async function setup() {
  const head = await createUser({ displayName: 'Hema Mehta' });
  const { family } = await createFamily(head.id);
  return { head, family, headHeaders: await signIn(head.id) };
}

// Sends an invite as the head and returns the raw token from the mail.
async function invite(headHeaders: Record<string, string>, email: string, relationship = 'dependent_parent') {
  const mail = captureMail();
  const res = await send('POST', '/families/current/invites', { email, relationship }, headHeaders);
  expect(res.status).toBe(201);
  const token = /token=([\w-]+)/.exec(mail[0]?.text ?? '')?.[1] ?? '';
  return { token, inviteId: res.data.invite.id as string };
}

async function insertInvite(values: Partial<typeof invites.$inferInsert> & { familyId: string; invitedBy: string }) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.insert(invites).values({
    email: 'mum@example.com',
    relationship: 'dependent_parent',
    tokenHash: hashToken(token),
    ...values,
  });
  return token;
}

describe('send invite', () => {
  test('mails a normalised address a link and stores only the token hash', async () => {
    const { headHeaders } = await setup();
    const mail = captureMail();

    const res = await send(
      'POST',
      '/families/current/invites',
      { email: ' Mum@Example.com ', relationship: 'dependent_parent' },
      headHeaders,
    );

    expect(res.status).toBe(201);
    expect(res.data.invite).toMatchObject({ email: 'mum@example.com', relationship: 'dependent_parent' });
    expect(mail).toHaveLength(1);
    expect(mail[0]?.to).toBe('mum@example.com');
    expect(mail[0]?.text).toContain('/invite?token=');
    const token = /token=([\w-]+)/.exec(mail[0]?.text ?? '')?.[1] ?? '';
    const rows = await db.select().from(invites);
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]?.tokenHash ?? [])).toEqual(Buffer.from(hashToken(token)));
    expect(token.length).toBeGreaterThan(20);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'invite.sent'));
    expect(audit).toHaveLength(1);
  });

  test('rejects a member who is not the head', async () => {
    const { family } = await setup();
    const member = await createUser();
    await addMember(family.id, member.id);

    const res = await send(
      'POST',
      '/families/current/invites',
      { email: 'a@example.com', relationship: 'spouse' },
      await signIn(member.id),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_head');
  });

  test('rejects inviting the head own email', async () => {
    const { head, headHeaders } = await setup();

    const res = await send(
      'POST',
      '/families/current/invites',
      { email: head.email.toUpperCase(), relationship: 'spouse' },
      headHeaders,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('cannot_invite_self');
  });

  test('rejects inviting an active member', async () => {
    const { family, headHeaders } = await setup();
    const member = await createUser({ email: 'mum@example.com' });
    await addMember(family.id, member.id);

    const res = await send(
      'POST',
      '/families/current/invites',
      { email: 'mum@example.com', relationship: 'dependent_parent' },
      headHeaders,
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_member');
  });

  test('re-inviting revokes the earlier invite', async () => {
    const { headHeaders } = await setup();
    const first = await invite(headHeaders, 'mum@example.com');

    const second = await invite(headHeaders, 'mum@example.com');

    const [row] = await db.select().from(invites).where(eq(invites.id, first.inviteId));
    expect(row?.revokedAt).not.toBeNull();
    expect((await send('GET', `/invites/${first.token}`, undefined)).body.code).toBe('invite_invalid');
    expect((await send('GET', `/invites/${second.token}`, undefined)).status).toBe(200);
  });

  test('re-inviting replaces an expired pending invite', async () => {
    const { head, family, headHeaders } = await setup();
    await insertInvite({ familyId: family.id, invitedBy: head.id, ...expiredDates() });

    const res = await send(
      'POST',
      '/families/current/invites',
      { email: 'mum@example.com', relationship: 'dependent_parent' },
      headHeaders,
    );

    expect(res.status).toBe(201);
  });
});

describe('list and revoke invites', () => {
  test('lists pending invites only to the head', async () => {
    const { head, family, headHeaders } = await setup();
    await invite(headHeaders, 'mum@example.com');
    await insertInvite({
      familyId: family.id,
      invitedBy: head.id,
      email: 'old@example.com',
      revokedAt: new Date().toISOString(),
    });
    const member = await createUser();
    await addMember(family.id, member.id);

    const res = await send('GET', '/families/current/invites', undefined, headHeaders);
    const forbidden = await send('GET', '/families/current/invites', undefined, await signIn(member.id));

    expect(res.status).toBe(200);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]).toMatchObject({ email: 'mum@example.com', expired: false });
    expect(forbidden.status).toBe(403);
  });

  test('revokes a pending invite once', async () => {
    const { headHeaders } = await setup();
    const { token, inviteId } = await invite(headHeaders, 'mum@example.com');

    const res = await send('DELETE', `/families/current/invites/${inviteId}`, undefined, headHeaders);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ revoked: true });
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'invite.revoked'));
    expect(audit).toHaveLength(1);
    expect((await send('GET', `/invites/${token}`, undefined)).status).toBe(404);
    expect((await send('DELETE', `/families/current/invites/${inviteId}`, undefined, headHeaders)).status).toBe(404);
    const list = await send('GET', '/families/current/invites', undefined, headHeaders);
    expect(list.data.items).toHaveLength(0);
  });

  test('hides another family invite', async () => {
    const { headHeaders } = await setup();
    const other = await createUser();
    const { family: otherFamily } = await createFamily(other.id, 'Shah');
    const [row] = await db
      .insert(invites)
      .values({
        familyId: otherFamily.id,
        invitedBy: other.id,
        email: 'x@example.com',
        relationship: 'other',
        tokenHash: hashToken('t'),
      })
      .returning();

    const res = await send('DELETE', `/families/current/invites/${row?.id}`, undefined, headHeaders);

    expect(res.status).toBe(404);
  });
});

describe('invite preview', () => {
  test('shows the family, inviter and relationship', async () => {
    const { headHeaders } = await setup();
    const { token } = await invite(headHeaders, 'mum@example.com', 'spouse');

    const res = await send('GET', `/invites/${token}`, undefined);

    expect(res.status).toBe(200);
    expect(res.data.invite).toMatchObject({
      familyName: 'Mehta',
      invitedByName: 'Hema Mehta',
      relationship: 'spouse',
      email: 'mum@example.com',
    });
  });

  test('returns 404 for an unknown, expired or accepted token', async () => {
    const { head, family, headHeaders } = await setup();
    const expired = await insertInvite({
      familyId: family.id,
      invitedBy: head.id,
      email: 'e@example.com',
      ...expiredDates(),
    });
    const mum = await createUser({ email: 'mum@example.com' });
    const { token: accepted } = await invite(headHeaders, 'mum@example.com');
    await send('POST', `/invites/${accepted}/acceptance`, undefined, await signIn(mum.id));

    for (const token of ['x'.repeat(43), expired, accepted]) {
      const res = await send('GET', `/invites/${token}`, undefined);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('invite_invalid');
    }
  });
});

describe('accept invite', () => {
  test('joins the family and tells the head and the new member', async () => {
    const { head, family, headHeaders } = await setup();
    const mum = await createUser({ email: 'mum@example.com' });
    const { token } = await invite(headHeaders, 'mum@example.com', 'dependent_parent');

    const res = await send('POST', `/invites/${token}/acceptance`, undefined, await signIn(mum.id));

    expect(res.status).toBe(201);
    expect(res.data.family.id).toBe(family.id);
    expect(res.data.me).toMatchObject({
      userId: mum.id,
      role: 'member',
      relationship: 'dependent_parent',
      canTrade: true,
    });
    const members = await db.select().from(familyMembers).where(eq(familyMembers.userId, mum.id));
    expect(members).toHaveLength(1);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'member.joined'));
    expect(audit.map((row) => row.subjectUserId).sort()).toEqual([head.id, mum.id].sort());
  });

  test('tells the current head, not the inviter, when the head has changed', async () => {
    const { head, family } = await setup();
    const token = await insertInvite({ familyId: family.id, invitedBy: head.id });
    const newHead = await createUser();
    await db.update(familyMembers).set({ role: 'member', relationship: null }).where(eq(familyMembers.userId, head.id));
    await db
      .insert(familyMembers)
      .values({ familyId: family.id, userId: newHead.id, role: 'head', relationship: 'self' });
    const mum = await createUser({ email: 'mum@example.com' });

    const res = await send('POST', `/invites/${token}/acceptance`, undefined, await signIn(mum.id));

    expect(res.status).toBe(201);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'member.joined'));
    expect(audit.map((row) => row.subjectUserId).sort()).toEqual([newHead.id, mum.id].sort());
  });

  test('joining as other removes stored broker credentials, since the engine may not trade for them', async () => {
    const { headHeaders } = await setup();
    const cousin = await createUser({ email: 'cousin@example.com' });
    const stored = await createBrokerAccount(cousin.id, { loginMethod: 'stored_credentials' });
    await createBrokerSecret(stored.id);
    const plain = await createBrokerAccount(cousin.id);
    const { token } = await invite(headHeaders, 'cousin@example.com', 'other');

    const res = await send('POST', `/invites/${token}/acceptance`, undefined, await signIn(cousin.id));

    expect(res.status).toBe(201);
    const [account] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, stored.id));
    expect(account?.loginMethod).toBe('broker_login');
    const [secret] = await db.select().from(brokerSecrets).where(eq(brokerSecrets.brokerAccountId, stored.id));
    expect(secret?.credentials).toBeNull();
    const removed = await db.select().from(auditLog).where(eq(auditLog.action, 'credentials.removed'));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ subjectUserId: cousin.id, actorUserId: cousin.id, targetId: stored.id });
    const [untouched] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, plain.id));
    expect(untouched?.loginMethod).toBe('broker_login');
  });

  test('joining as a trading relationship keeps stored broker credentials', async () => {
    const { headHeaders } = await setup();
    const mum = await createUser({ email: 'mum@example.com' });
    const stored = await createBrokerAccount(mum.id, { loginMethod: 'stored_credentials' });
    await createBrokerSecret(stored.id);
    const { token } = await invite(headHeaders, 'mum@example.com', 'dependent_parent');

    await send('POST', `/invites/${token}/acceptance`, undefined, await signIn(mum.id));

    const [account] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, stored.id));
    expect(account?.loginMethod).toBe('stored_credentials');
    const [secret] = await db.select().from(brokerSecrets).where(eq(brokerSecrets.brokerAccountId, stored.id));
    expect(secret?.credentials).not.toBeNull();
  });

  test('rejects a user with a different email', async () => {
    const { headHeaders } = await setup();
    const stranger = await createUser({ email: 'stranger@example.com' });
    const { token } = await invite(headHeaders, 'mum@example.com');

    const res = await send('POST', `/invites/${token}/acceptance`, undefined, await signIn(stranger.id));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('invite_email_mismatch');
    expect(await db.select().from(familyMembers).where(eq(familyMembers.userId, stranger.id))).toHaveLength(0);
  });

  test('rejects a user who is already in a family', async () => {
    const { headHeaders } = await setup();
    const mum = await createUser({ email: 'mum@example.com' });
    await createFamily(mum.id, 'Shah');
    const { token } = await invite(headHeaders, 'mum@example.com');

    const res = await send('POST', `/invites/${token}/acceptance`, undefined, await signIn(mum.id));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_in_family');
  });

  test('a second acceptance of the same token returns 404', async () => {
    const { headHeaders } = await setup();
    const mum = await createUser({ email: 'mum@example.com' });
    const { token } = await invite(headHeaders, 'mum@example.com');
    const headers = await signIn(mum.id);
    await send('POST', `/invites/${token}/acceptance`, undefined, headers);

    const res = await send('POST', `/invites/${token}/acceptance`, undefined, headers);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('invite_invalid');
  });

  test('two simultaneous acceptances create one membership', async () => {
    const { headHeaders } = await setup();
    const mum = await createUser({ email: 'mum@example.com' });
    const { token } = await invite(headHeaders, 'mum@example.com');
    const headers = await signIn(mum.id);

    const results = await Promise.all([
      send('POST', `/invites/${token}/acceptance`, undefined, headers),
      send('POST', `/invites/${token}/acceptance`, undefined, headers),
    ]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 404)).toHaveLength(1);
    expect(await db.select().from(familyMembers).where(eq(familyMembers.userId, mum.id))).toHaveLength(1);
  });
});
