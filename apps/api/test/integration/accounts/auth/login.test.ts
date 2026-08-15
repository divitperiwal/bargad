import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { sessions, users } from '#database/schema';
import { createUserWithPassword, TEST_PASSWORD } from '#test/integration/fixtures';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const login = (overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  post('/auth/login', { email: 'asha@example.com', password: TEST_PASSWORD, client: 'web', ...overrides }, headers);

describe('POST /auth/login', () => {
  test('signs in on web and app, with the email in upper case', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });

    const web = await login({ email: 'ASHA@Example.com' });
    expect(web.status).toBe(200);
    const cookie = (web.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect((await app.request('/auth/me', { headers: { Cookie: cookie } })).status).toBe(200);

    const mobile = await login({ client: 'app' });
    expect(mobile.status).toBe(200);
    const { token } = (await mobile.json()).data;
    expect((await app.request('/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  test('answers a wrong password and an unknown email with the same 401', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });

    const wrongPassword = await login({ password: 'wrong password!' });
    const unknownEmail = await login({ email: 'nobody@example.com' });

    expect(wrongPassword.status).toBe(401);
    const body = await wrongPassword.json();
    expect(body.code).toBe('invalid_credentials');
    expect(unknownEmail.status).toBe(401);
    expect(await unknownEmail.json()).toEqual(body);
  });

  test('rejects a deleted user', async () => {
    const user = await createUserWithPassword({ email: 'asha@example.com' });
    await db.update(users).set({ deletedAt: new Date().toISOString() }).where(eq(users.id, user.id));

    const res = await login();

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_credentials');
  });

  test('rate limits the 11th attempt in a minute from one client', async () => {
    const headers = { 'X-Forwarded-For': '203.0.113.7' };
    for (let i = 0; i < 10; i++) expect((await login({ email: 'nobody@example.com' }, headers)).status).toBe(401);

    expect((await login({ email: 'nobody@example.com' }, headers)).status).toBe(429);
  });
});

describe('POST /auth/logout', () => {
  test('revokes the session and clears the cookie', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    const signedIn = await login();
    const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const res = await post('/auth/logout', {}, { Cookie: cookie });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ signedOut: true });
    expect(res.headers.get('set-cookie')).toMatch(/session=;/);
    const [session] = await db.select().from(sessions);
    expect(session?.revokedAt).not.toBeNull();
    expect((await app.request('/auth/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  test('requires a session', async () => {
    expect((await post('/auth/logout', {})).status).toBe(401);
  });
});
