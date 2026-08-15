import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { sessions, users } from '#database/schema';
import { hashToken } from '#utils/security/crypto.util';

const body = {
  displayName: 'Asha Rao',
  email: 'Asha@Example.com',
  mobile: '9876543210',
  dateOfBirth: '1990-05-17',
  password: 'correct horse battery',
  acceptTerms: true,
  client: 'web',
};

const signup = (overrides: Record<string, unknown> = {}) =>
  app.request('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...overrides }),
  });

describe('POST /auth/signup', () => {
  test('web sign-up sets an HttpOnly session cookie that works on /auth/me', async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.user.email).toBe('asha@example.com');
    expect(json.data.token).toBeUndefined();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const me = await app.request('/auth/me', { headers: { Cookie: cookie.split(';')[0] ?? '' } });
    expect(me.status).toBe(200);
    expect((await me.json()).data.user.email).toBe('asha@example.com');
  });

  test('app sign-up returns a bearer token and no cookie', async () => {
    const res = await signup({ client: 'app' });

    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
    const { token } = (await res.json()).data;
    const me = await app.request('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
  });

  test('stores the profile, an argon2id hash, and only the hash of the session token', async () => {
    const res = await signup({ client: 'app' });
    const { token, user } = (await res.json()).data;

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.mobile).toBe('9876543210');
    expect(row?.dateOfBirth).toBe('1990-05-17');
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);

    const [session] = await db.select().from(sessions);
    expect(Buffer.from(session?.tokenHash ?? []).equals(Buffer.from(hashToken(token)))).toBe(true);
    expect(session?.client).toBe('app');
    expect(JSON.stringify(session)).not.toContain(token);
  });

  test('rejects the same email in a different case with 409 email_taken', async () => {
    await signup();
    const res = await signup({ email: 'ASHA@example.com' });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('email_taken');
  });

  test('rejects a date of birth under 18 with issues.dateOfBirth', async () => {
    const res = await signup({ dateOfBirth: new Date().toISOString().slice(0, 10) });

    expect(res.status).toBe(400);
    expect((await res.json()).issues.dateOfBirth).toBeDefined();
  });
});
