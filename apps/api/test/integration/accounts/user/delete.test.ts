import { describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import {
  auditLog,
  brokerAccounts,
  brokerSecrets,
  families,
  familyMembers,
  invites,
  passkeys,
  users,
} from '#database/schema';
import {
  addMember,
  createBrokerAccount,
  createBrokerSecret,
  createFamily,
  createUserWithPassword,
  signIn,
  TEST_PASSWORD,
} from '#test/integration/fixtures';
import { hashToken } from '#utils/security/crypto.util';

const send = async (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json, data: json.data, headers: res.headers };
};

const deleteAccount = (headers: Record<string, string>, password = TEST_PASSWORD) =>
  send('DELETE', '/users/me', { password }, headers);

async function withPasskeyAndBroker(userId: string) {
  await db.insert(passkeys).values({
    userId,
    credentialId: new Uint8Array(crypto.getRandomValues(new Uint8Array(16))),
    publicKey: new Uint8Array([1, 2, 3]),
    name: 'Phone',
  });
  const account = await createBrokerAccount(userId);
  await createBrokerSecret(account.id);
  return account;
}

describe('DELETE /users/me', () => {
  test('rejects a wrong password and changes nothing', async () => {
    const user = await createUserWithPassword();
    const { family } = await createFamily((await createUserWithPassword()).id);
    await addMember(family.id, user.id);
    await withPasskeyAndBroker(user.id);
    const headers = await signIn(user.id);

    const res = await deleteAccount(headers, 'not the password');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.deletedAt).toBeNull();
    const [member] = await db.select().from(familyMembers).where(eq(familyMembers.userId, user.id));
    expect(member?.leftAt).toBeNull();
    expect(await db.select().from(passkeys).where(eq(passkeys.userId, user.id))).toHaveLength(1);
    expect((await send('GET', '/families/current', undefined, headers)).status).toBe(200);
  });

  test('ends a member’s account, family membership, sessions, passkeys and broker access', async () => {
    const head = await createUserWithPassword();
    const user = await createUserWithPassword();
    const { family } = await createFamily(head.id);
    await addMember(family.id, user.id);
    const account = await withPasskeyAndBroker(user.id);
    const headers = await signIn(user.id);

    const res = await deleteAccount(headers);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: true });
    expect(res.headers.get('set-cookie') ?? '').toContain('session=;');
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.deletedAt).not.toBeNull();
    const [member] = await db.select().from(familyMembers).where(eq(familyMembers.userId, user.id));
    expect(member?.leftReason).toBe('left');
    expect((await send('GET', '/auth/me', undefined, headers)).status).toBe(401);
    expect(await db.select().from(passkeys).where(eq(passkeys.userId, user.id))).toHaveLength(0);
    const [broker] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, account.id));
    expect(broker?.status).toBe('closed');
    const [secret] = await db.select().from(brokerSecrets).where(eq(brokerSecrets.brokerAccountId, account.id));
    expect(secret?.credentials).toBeNull();
    const [deleted] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'user.deleted'), eq(auditLog.subjectUserId, user.id)));
    expect(deleted).toBeDefined();
  });

  test('lets the same email sign up again', async () => {
    const user = await createUserWithPassword({ email: `again-${crypto.randomUUID()}@bargad.test` });
    await deleteAccount(await signIn(user.id));

    const res = await send('POST', '/auth/signup', {
      displayName: 'Asha Rao',
      email: user.email,
      mobile: '9876543210',
      dateOfBirth: '1990-05-17',
      password: TEST_PASSWORD,
      acceptTerms: true,
      client: 'web',
    });

    expect(res.status).toBe(201);
  });

  test('makes a head with members hand the family over first', async () => {
    const head = await createUserWithPassword();
    const member = await createUserWithPassword();
    const { family } = await createFamily(head.id);
    await addMember(family.id, member.id);

    const res = await deleteAccount(await signIn(head.id));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('head_must_hand_over');
    const [row] = await db.select().from(families).where(eq(families.id, family.id));
    expect(row?.dissolvedAt).toBeNull();
    const rows = await db.select().from(familyMembers).where(eq(familyMembers.familyId, family.id));
    for (const r of rows) expect(r.leftAt).toBeNull();
  });

  test('dissolves the family when its only member, the head, deletes their account', async () => {
    const head = await createUserWithPassword();
    const { family } = await createFamily(head.id);

    const res = await deleteAccount(await signIn(head.id));

    expect(res.status).toBe(200);
    const [row] = await db.select().from(families).where(eq(families.id, family.id));
    expect(row?.dissolvedAt).not.toBeNull();
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'family.dissolved'), eq(auditLog.familyId, family.id)));
    expect(audit.map((a) => a.subjectUserId)).toEqual([head.id]);
  });
});

describe('DELETE /users/me by a head with a pending invite', () => {
  test('revokes the family’s pending invites', async () => {
    const head = await createUserWithPassword();
    const { family } = await createFamily(head.id);
    const token = crypto.randomUUID() + crypto.randomUUID();
    await db.insert(invites).values({
      familyId: family.id,
      invitedBy: head.id,
      email: 'mum@example.com',
      relationship: 'dependent_parent',
      tokenHash: hashToken(token),
    });

    await deleteAccount(await signIn(head.id));

    const preview = await send('GET', `/invites/${token}`, undefined);
    expect(preview.status).toBe(404);
    expect(preview.body.code).toBe('invite_invalid');
    const [row] = await db.select().from(invites).where(eq(invites.familyId, family.id));
    expect(row?.revokedAt).not.toBeNull();
  });
});
