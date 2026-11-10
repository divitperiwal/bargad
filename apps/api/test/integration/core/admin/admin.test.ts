import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, brokerAccounts, killSwitches } from '#database/schema';
import { createBrokerAccount, createBrokerSecret, createFamily, createUser, signIn } from '#test/integration/fixtures';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, code: json.code as string | undefined, data: json.data };
};

const asAdmin = async () => {
  const admin = await createUser({ isAdmin: true });
  return { admin, headers: await signIn(admin.id) };
};

const globalSwitch = { scope: 'global', scopeKey: '', engaged: true, reason: 'Broker outage' };

describe('admin routes', () => {
  test('answer 403 to a non-admin', async () => {
    const headers = await signIn((await createUser()).id);
    const account = await createBrokerAccount((await createUser()).id);

    const list = await send('GET', '/admin/kill-switches', headers);
    const put = await send('PUT', '/admin/kill-switches', headers, globalSwitch);
    const revoke = await send('DELETE', `/admin/broker-accounts/${account.id}/credentials`, headers);

    for (const res of [list, put, revoke]) {
      expect(res.status).toBe(403);
      expect(res.code).toBe('forbidden');
    }
  });
});

describe('kill switches', () => {
  test('an admin engages and then releases the global switch, with audit rows', async () => {
    const { admin, headers } = await asAdmin();

    const engaged = await send('PUT', '/admin/kill-switches', headers, globalSwitch);
    const released = await send('PUT', '/admin/kill-switches', headers, { ...globalSwitch, engaged: false });

    expect(engaged.status).toBe(200);
    expect(engaged.data.killSwitch).toMatchObject({
      scope: 'global',
      scopeKey: '',
      engaged: true,
      changedBy: admin.id,
    });
    expect(engaged.data.killSwitch.changedAt).toBe(new Date(engaged.data.killSwitch.changedAt).toISOString());
    expect(released.data.killSwitch.engaged).toBe(false);
    const rows = await db.select().from(killSwitches);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.engaged).toBe(false);
    const actions = (await db.select().from(auditLog)).map((row) => row.action).sort();
    expect(actions).toEqual(['kill_switch.engaged', 'kill_switch.released']);
    expect((await db.select().from(auditLog))[0]?.subjectUserId).toBe(admin.id);
  });

  test('lists the switches', async () => {
    const { headers } = await asAdmin();
    await send('PUT', '/admin/kill-switches', headers, globalSwitch);

    const res = await send('GET', '/admin/kill-switches', headers);

    expect(res.status).toBe(200);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]).toMatchObject({ scope: 'global', engaged: true, reason: 'Broker outage' });
  });

  test('accepts an existing family and a known broker', async () => {
    const { headers } = await asAdmin();
    const { family } = await createFamily((await createUser()).id);

    const familySwitch = await send('PUT', '/admin/kill-switches', headers, {
      scope: 'family',
      scopeKey: family.id,
      engaged: true,
      reason: 'Review',
    });
    const brokerSwitch = await send('PUT', '/admin/kill-switches', headers, {
      scope: 'broker',
      scopeKey: 'dhan',
      engaged: true,
      reason: 'Outage',
    });

    expect(familySwitch.status).toBe(200);
    expect(brokerSwitch.status).toBe(200);
  });

  test.each([
    ['global with a key', { scope: 'global', scopeKey: 'x' }],
    ['an unknown family', { scope: 'family', scopeKey: crypto.randomUUID() }],
    ['a family key that is not a uuid', { scope: 'family', scopeKey: 'nope' }],
    ['an unknown broker', { scope: 'broker', scopeKey: 'zerodha' }],
  ])('answers 400 for %s', async (_name, change) => {
    const { headers } = await asAdmin();

    const res = await send('PUT', '/admin/kill-switches', headers, { ...globalSwitch, ...change });

    expect(res.status).toBe(400);
    expect(await db.select().from(killSwitches)).toHaveLength(0);
  });
});

describe('DELETE /admin/broker-accounts/:id/credentials', () => {
  test('wipes the credentials, asks for a relink and tells the owner', async () => {
    const { admin, headers } = await asAdmin();
    const owner = await createUser();
    const account = await createBrokerAccount(owner.id, { loginMethod: 'stored_credentials' });
    await createBrokerSecret(account.id);

    const res = await send('DELETE', `/admin/broker-accounts/${account.id}/credentials`, headers);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ revoked: true });
    const [row] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, account.id));
    expect(row).toMatchObject({ status: 'needs_relink', loginMethod: 'broker_login' });
    const feed = await send('GET', '/feed', await signIn(owner.id));
    const event = feed.data.items.find((item: { action: string }) => item.action === 'credentials.revoked_by_admin');
    expect(event).toMatchObject({ actorUserId: admin.id, targetId: account.id });
  });

  test('answers 404 for an unknown account', async () => {
    const { headers } = await asAdmin();

    const res = await send('DELETE', `/admin/broker-accounts/${crypto.randomUUID()}/credentials`, headers);

    expect(res.status).toBe(404);
  });
});
