import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, passkeys } from '#database/schema';
import { createUser, signIn } from '#test/integration/fixtures';
import {
  type Authenticator,
  createAuthenticator,
  registerPasskey,
  signPasskeyManage,
  signStepUp,
} from '#test/integration/webauthn';

const send = async (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json, data: json.data, headers: res.headers };
};
const post = (path: string, body: unknown, headers?: Record<string, string>) => send('POST', path, body, headers);

describe('passkey registration', () => {
  test('registers a passkey', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);

    const { passkeyId } = await registerPasskey(headers);

    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId));
    expect(row?.userId).toBe(user.id);
    expect(row?.name).toBe('Test passkey');
    expect(row?.publicKey.length).toBeGreaterThan(0);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'passkey.added'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.subjectUserId).toBe(user.id);
  });

  test('rejects a reused registration challenge and adds no second row', async () => {
    const headers = await signIn((await createUser()).id);
    const { challengeId, options } = (await post('/passkeys/registration-options', {}, headers)).data;
    const first = createAuthenticator().register(options);
    const second = createAuthenticator().register(options);
    expect((await post('/passkeys', { challengeId, response: first, name: 'Phone' }, headers)).status).toBe(201);

    const res = await post('/passkeys', { challengeId, response: second, name: 'Laptop' }, headers);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('passkey_failed');
    expect(await db.select().from(passkeys)).toHaveLength(1);
  });

  test('rejects a response made for another origin', async () => {
    const headers = await signIn((await createUser()).id);
    const { challengeId, options } = (await post('/passkeys/registration-options', {}, headers)).data;
    const response = createAuthenticator().register(options, { origin: 'https://evil.example' });

    const res = await post('/passkeys', { challengeId, response, name: 'Phone' }, headers);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('passkey_failed');
    expect(await db.select().from(passkeys)).toHaveLength(0);
  });
});

describe('managing passkeys', () => {
  test('lists only the caller’s passkeys', async () => {
    const asha = await signIn((await createUser()).id);
    const ravi = await signIn((await createUser()).id);
    const { passkeyId } = await registerPasskey(asha);
    await registerPasskey(ravi);

    const res = await send('GET', '/passkeys', undefined, asha);

    expect(res.status).toBe(200);
    expect(res.data.items).toEqual([
      { id: passkeyId, name: 'Test passkey', createdAt: expect.any(String), lastUsedAt: null },
    ]);
    expect(res.data.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('renames a passkey', async () => {
    const headers = await signIn((await createUser()).id);
    const { passkeyId } = await registerPasskey(headers);

    const res = await send('PATCH', `/passkeys/${passkeyId}`, { name: ' Work laptop ' }, headers);

    expect(res.status).toBe(200);
    expect(res.data.passkey).toMatchObject({ id: passkeyId, name: 'Work laptop' });
    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId));
    expect(row?.name).toBe('Work laptop');
  });

  test('deletes a passkey and records it', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);
    const { passkeyId, authenticator } = await registerPasskey(headers);
    const assertion = await signPasskeyManage(headers, authenticator);

    const res = await send('DELETE', `/passkeys/${passkeyId}`, { assertion }, headers);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: true });
    expect(await db.select().from(passkeys)).toHaveLength(0);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'passkey.removed'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(passkeyId);
  });

  test('answers 404 for another user’s passkey on rename and delete', async () => {
    const asha = await signIn((await createUser()).id);
    const ravi = await signIn((await createUser()).id);
    const { passkeyId } = await registerPasskey(ravi);

    const renamed = await send('PATCH', `/passkeys/${passkeyId}`, { name: 'Mine now' }, asha);
    const deleted = await send('DELETE', `/passkeys/${passkeyId}`, {}, asha);

    expect(renamed.status).toBe(404);
    expect(deleted.status).toBe(404);
    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId));
    expect(row?.name).toBe('Test passkey');
  });
});

describe('adding or removing a passkey when one exists', () => {
  async function userWithPasskey() {
    const user = await createUser();
    const headers = await signIn(user.id);
    const { passkeyId, authenticator } = await registerPasskey(headers);
    return { user, headers, passkeyId, authenticator };
  }

  test('a second passkey without an assertion gets 403 passkey_failed and adds no row', async () => {
    const { headers } = await userWithPasskey();

    const res = await post('/passkeys/registration-options', {}, headers);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('passkey_failed');
    expect(await db.select().from(passkeys)).toHaveLength(1);
  });

  test('a second passkey with a passkey_manage assertion is added', async () => {
    const { user, headers, authenticator } = await userWithPasskey();

    const { passkeyId } = await registerPasskey(headers, createAuthenticator(), authenticator);

    const rows = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    expect(rows.map((row) => row.id)).toContain(passkeyId);
    expect(rows).toHaveLength(2);
  });

  test('a challenge issued before the first passkey cannot add a second one', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);
    const stale = (await post('/passkeys/registration-options', {}, headers)).data;
    await registerPasskey(headers);

    const response = createAuthenticator().register(stale.options);
    const res = await post('/passkeys', { challengeId: stale.challengeId, response, name: 'Attacker' }, headers);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('passkey_failed');
    expect(await db.select().from(passkeys).where(eq(passkeys.userId, user.id))).toHaveLength(1);
  });

  test('two first registrations at once leave exactly one passkey', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);
    const first = (await post('/passkeys/registration-options', {}, headers)).data;
    const second = (await post('/passkeys/registration-options', {}, headers)).data;

    const results = await Promise.all(
      [first, second].map(({ challengeId, options }) =>
        post('/passkeys', { challengeId, response: createAuthenticator().register(options), name: 'Phone' }, headers),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(await db.select().from(passkeys).where(eq(passkeys.userId, user.id))).toHaveLength(1);
  });

  test('an approve assertion cannot stand in for passkey_manage', async () => {
    const { user, headers, authenticator } = await userWithPasskey();
    const assertion = await signStepUp(headers, authenticator, 'approve', user.id);

    const res = await post('/passkeys/registration-options', { assertion }, headers);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('passkey_failed');
  });

  test('deleting without an assertion gets 403 and the passkey remains', async () => {
    const { headers, passkeyId } = await userWithPasskey();

    const res = await send('DELETE', `/passkeys/${passkeyId}`, {}, headers);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('passkey_failed');
    expect(await db.select().from(passkeys).where(eq(passkeys.id, passkeyId))).toHaveLength(1);
  });

  test('deleting with a passkey_manage assertion removes it', async () => {
    const { headers, passkeyId, authenticator } = await userWithPasskey();
    const assertion = await signPasskeyManage(headers, authenticator);

    const res = await send('DELETE', `/passkeys/${passkeyId}`, { assertion }, headers);

    expect(res.status).toBe(200);
    expect(await db.select().from(passkeys)).toHaveLength(0);
  });
});

describe('passkey login', () => {
  const signInWithPasskey = async (authenticator: Authenticator, client: 'web' | 'app') => {
    const { challengeId, options } = (await post('/auth/passkey/options', {})).data;
    return post('/auth/passkey/login', { challengeId, response: authenticator.authenticate(options), client });
  };

  test('signs in on web and app and records when the passkey was used', async () => {
    const user = await createUser();
    const { passkeyId, authenticator } = await registerPasskey(await signIn(user.id));

    const web = await signInWithPasskey(authenticator, 'web');
    expect(web.status).toBe(200);
    expect(web.data.user.id).toBe(user.id);
    const cookie = (web.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect((await app.request('/auth/me', { headers: { Cookie: cookie } })).status).toBe(200);

    const mobile = await signInWithPasskey(authenticator, 'app');
    expect(mobile.status).toBe(200);
    const auth = { Authorization: `Bearer ${mobile.data.token}` };
    expect((await app.request('/auth/me', { headers: auth })).status).toBe(200);

    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  test('rejects a deleted passkey', async () => {
    const headers = await signIn((await createUser()).id);
    const { passkeyId, authenticator } = await registerPasskey(headers);
    const assertion = await signPasskeyManage(headers, authenticator);
    expect((await send('DELETE', `/passkeys/${passkeyId}`, { assertion }, headers)).status).toBe(200);

    const res = await signInWithPasskey(authenticator, 'web');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('passkey_failed');
  });

  test('rejects a replayed login challenge', async () => {
    const { authenticator } = await registerPasskey(await signIn((await createUser()).id));
    const { challengeId, options } = (await post('/auth/passkey/options', {})).data;
    const body = { challengeId, response: authenticator.authenticate(options), client: 'app' };
    expect((await post('/auth/passkey/login', body)).status).toBe(200);

    const res = await post('/auth/passkey/login', body);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('passkey_failed');
  });
});
