import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, jobs } from '#database/schema';
import {
  createBrokerAccount,
  createUser,
  createUserWithPassword,
  signIn,
  TEST_PASSWORD,
} from '#test/integration/fixtures';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, code: json.code as string | undefined, data: json.data };
};

const link = { broker: 'dhan', brokerClientId: 'D1001', label: 'Main' };

describe('POST /broker-accounts', () => {
  test('links an account, queues a holdings sync on its lane and audits it', async () => {
    const user = await createUser();

    const res = await send('POST', '/broker-accounts', await signIn(user.id), link);

    expect(res.status).toBe(201);
    expect(res.data.account).toMatchObject({
      broker: 'dhan',
      brokerClientId: 'D1001',
      label: 'Main',
      loginMethod: 'broker_login',
      hidden: false,
      status: 'active',
      holdingsSyncedAt: null,
      hasStoredCredentials: false,
    });
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      kind: 'holdings_sync',
      lane: res.data.account.id,
      payload: { brokerAccountId: res.data.account.id },
    });
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'broker_account.linked'));
    expect(audit).toMatchObject({ subjectUserId: user.id, targetId: res.data.account.id });
  });

  test('answers 409 broker_account_taken when anyone links the same account again', async () => {
    const first = await createUser();
    const second = await createUser();
    await send('POST', '/broker-accounts', await signIn(first.id), link);

    const again = await send('POST', '/broker-accounts', await signIn(second.id), link);

    expect(again.status).toBe(409);
    expect(again.code).toBe('broker_account_taken');
  });
});

describe('linking an account a deleted user had linked', () => {
  test('works for a new user, because the old link is closed', async () => {
    const gone = await createUserWithPassword();
    const goneHeaders = await signIn(gone.id);
    expect((await send('POST', '/broker-accounts', goneHeaders, link)).status).toBe(201);
    expect((await send('DELETE', '/users/me', goneHeaders, { password: TEST_PASSWORD })).status).toBe(200);
    const returning = await createUser();

    const res = await send('POST', '/broker-accounts', await signIn(returning.id), link);

    expect(res.status).toBe(201);
    expect(res.data.account).toMatchObject({ brokerClientId: 'D1001', status: 'active' });
  });
});

describe('GET /broker-accounts', () => {
  test('lists only the caller’s accounts', async () => {
    const asha = await createUser();
    const ravi = await createUser();
    const mine = await createBrokerAccount(asha.id);
    await createBrokerAccount(ravi.id);

    const res = await send('GET', '/broker-accounts', await signIn(asha.id));

    expect(res.status).toBe(200);
    expect(res.data.items.map((item: { id: string }) => item.id)).toEqual([mine.id]);
  });

  test('reports hasStoredCredentials from the login method', async () => {
    const user = await createUser();
    await createBrokerAccount(user.id, { loginMethod: 'stored_credentials' });

    const res = await send('GET', '/broker-accounts', await signIn(user.id));

    expect(res.data.items[0].hasStoredCredentials).toBe(true);
  });
});

describe('PATCH /broker-accounts/:id', () => {
  test('hides an account and audits it', async () => {
    const user = await createUser();
    const account = await createBrokerAccount(user.id);

    const res = await send('PATCH', `/broker-accounts/${account.id}`, await signIn(user.id), { hidden: true });

    expect(res.status).toBe(200);
    expect(res.data.account.hidden).toBe(true);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'broker_account.hidden'));
    expect(audit).toMatchObject({ subjectUserId: user.id, targetId: account.id });
  });

  test('answers 400 invalid_request for an empty body', async () => {
    const user = await createUser();
    const account = await createBrokerAccount(user.id);

    const res = await send('PATCH', `/broker-accounts/${account.id}`, await signIn(user.id), {});

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_request');
  });

  test('un-hides an account and audits it', async () => {
    const user = await createUser();
    const account = await createBrokerAccount(user.id, { hidden: true });

    const res = await send('PATCH', `/broker-accounts/${account.id}`, await signIn(user.id), { hidden: false });

    expect(res.data.account.hidden).toBe(false);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'broker_account.unhidden'));
    expect(audit).toMatchObject({ subjectUserId: user.id, targetId: account.id });
  });

  test('writes no audit row when hidden is unchanged', async () => {
    const user = await createUser();
    const account = await createBrokerAccount(user.id, { hidden: true });

    await send('PATCH', `/broker-accounts/${account.id}`, await signIn(user.id), { hidden: true, label: 'Same' });

    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  test('renames without an audit event', async () => {
    const user = await createUser();
    const account = await createBrokerAccount(user.id);

    const res = await send('PATCH', `/broker-accounts/${account.id}`, await signIn(user.id), { label: 'Renamed' });

    expect(res.data.account.label).toBe('Renamed');
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  test('answers 404 for another user’s account', async () => {
    const owner = await createUser();
    const other = await createUser();
    const account = await createBrokerAccount(owner.id);

    const res = await send('PATCH', `/broker-accounts/${account.id}`, await signIn(other.id), { hidden: true });

    expect(res.status).toBe(404);
  });
});
