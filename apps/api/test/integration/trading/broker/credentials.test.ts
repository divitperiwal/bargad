import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { engineConfig } from '#config/engine.config';
import { auditLog, brokerAccounts, brokerSecrets } from '#database/schema';
import { openSealed } from '#test/integration/engine';
import { addMember, createBrokerAccount, createFamily, createUser, signIn } from '#test/integration/fixtures';
import { registerPasskey, signStepUp } from '#test/integration/webauthn';

const PIN = '482915';
const SECRET = 'JBSWY3DPEHPK3PXP';

async function ownerWithAccount() {
  const user = await createUser();
  const headers = await signIn(user.id);
  const { authenticator } = await registerPasskey(headers);
  const account = await createBrokerAccount(user.id);
  return { user, headers, authenticator, account };
}

const put = async (
  headers: Record<string, string>,
  accountId: string,
  assertion: unknown,
  extra: { pin?: string; totpSecret?: string } = {},
) => {
  const res = await app.request(`/broker-accounts/${accountId}/credentials`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ pin: PIN, totpSecret: SECRET, assertion, ...extra }),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
};

const secretOf = async (accountId: string) =>
  (await db.select().from(brokerSecrets).where(eq(brokerSecrets.brokerAccountId, accountId)))[0];

const openedPin = async (accountId: string) => {
  const opened = await openSealed((await secretOf(accountId))?.credentials as Uint8Array);
  return JSON.parse(new TextDecoder().decode(opened));
};

describe('PUT /broker-accounts/:id/credentials', () => {
  test('seals the pin and secret for the engine and marks the account', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);

    const res = await put(headers, account.id, assertion);

    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ stored: true });
    expect((await secretOf(account.id))?.keyVersion).toBe(engineConfig.keyVersion);
    expect(await openedPin(account.id)).toEqual({ pin: PIN, totpSecret: SECRET });
    const [row] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, account.id));
    expect(row?.loginMethod).toBe('stored_credentials');
  });

  test('keeps the pin and secret out of the response and the audit row', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);

    const res = await put(headers, account.id, assertion);

    expect(res.text).not.toContain(PIN);
    expect(res.text).not.toContain(SECRET);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'credentials.set'));
    expect(audit).toMatchObject({ targetId: account.id });
    expect(JSON.stringify(audit?.detail)).not.toContain(PIN);
    expect(JSON.stringify(audit?.detail)).not.toContain(SECRET);
  });

  test('replaces credentials already stored', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    await put(headers, account.id, await signStepUp(headers, authenticator, 'credentials', account.id));

    const res = await put(headers, account.id, await signStepUp(headers, authenticator, 'credentials', account.id), {
      pin: '9999',
    });

    expect(res.status).toBe(200);
    expect((await openedPin(account.id)).pin).toBe('9999');
  });

  test('answers 403 passkey_failed and stores nothing when the assertion is for another account', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    const assertion = await signStepUp(headers, authenticator, 'credentials', crypto.randomUUID());

    const res = await put(headers, account.id, assertion);

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('passkey_failed');
    expect(await secretOf(account.id)).toBeUndefined();
  });

  test('answers 403 cannot_trade for a member whose relationship is other', async () => {
    const head = await createUser();
    const { family } = await createFamily(head.id);
    const { user, headers, authenticator, account } = await ownerWithAccount();
    await addMember(family.id, user.id, 'other');
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);

    const res = await put(headers, account.id, assertion);

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('cannot_trade');
    expect(await secretOf(account.id)).toBeUndefined();
  });

  test('allows a member whose relationship can trade', async () => {
    const head = await createUser();
    const { family } = await createFamily(head.id);
    const { user, headers, authenticator, account } = await ownerWithAccount();
    await addMember(family.id, user.id, 'spouse');
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);

    const res = await put(headers, account.id, assertion);

    expect(res.status).toBe(200);
  });

  test('answers 404 for another user account', async () => {
    const owner = await createUser();
    const account = await createBrokerAccount(owner.id);
    const { headers, authenticator } = await ownerWithAccount();
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);

    const res = await put(headers, account.id, assertion);

    expect(res.status).toBe(404);
  });

  test('answers 503 credentials_unavailable when no engine key is configured', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);
    const key = engineConfig.publicKey;
    engineConfig.publicKey = undefined;

    try {
      const res = await put(headers, account.id, assertion);

      expect(res.status).toBe(503);
      expect(res.json.code).toBe('credentials_unavailable');
    } finally {
      engineConfig.publicKey = key;
    }
  });

  test('rejects a pin that is not 4 to 12 digits', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    const assertion = await signStepUp(headers, authenticator, 'credentials', account.id);

    const res = await put(headers, account.id, assertion, { pin: '12ab' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /broker-accounts/:id/credentials', () => {
  test('wipes the credentials and returns to broker login', async () => {
    const { headers, authenticator, account } = await ownerWithAccount();
    await put(headers, account.id, await signStepUp(headers, authenticator, 'credentials', account.id));

    const res = await app.request(`/broker-accounts/${account.id}/credentials`, { method: 'DELETE', headers });

    expect(res.status).toBe(200);
    expect((await secretOf(account.id))?.credentials).toBeNull();
    const [row] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, account.id));
    expect(row?.loginMethod).toBe('broker_login');
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'credentials.removed'));
    expect(audit?.targetId).toBe(account.id);
  });

  test('answers 404 for another user account', async () => {
    const owner = await createUser();
    const account = await createBrokerAccount(owner.id);
    const other = await signIn((await createUser()).id);

    const res = await app.request(`/broker-accounts/${account.id}/credentials`, { method: 'DELETE', headers: other });

    expect(res.status).toBe(404);
  });
});
