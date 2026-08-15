import { describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '#config/database.config';
import { sessions, users } from '#database/schema';
import { requireUser } from '#middlewares/auth.middleware';
import { errorHandler } from '#middlewares/error.middleware';
import { createUser, signIn } from '#test/integration/fixtures';
import type { AuthEnv } from '#types/hono.types';

const app = new Hono<AuthEnv>().onError(errorHandler).get('/me', requireUser, (c) => c.json(c.var.user));

describe('requireUser', () => {
  test('signs in with a cookie or a bearer token', async () => {
    const user = await createUser({ displayName: 'Asha' });
    for (const client of ['web', 'app'] as const) {
      const res = await app.request('/me', { headers: await signIn(user.id, client) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: user.id, displayName: 'Asha' });
    }
  });

  test('rejects missing, unknown, revoked and expired sessions, and deleted users', async () => {
    expect((await app.request('/me')).status).toBe(401);
    expect((await app.request('/me', { headers: { Cookie: 'session=nope' } })).status).toBe(401);

    const user = await createUser();
    const headers = await signIn(user.id);
    await db.update(sessions).set({ revokedAt: new Date().toISOString() });
    expect((await app.request('/me', { headers })).status).toBe(401);

    const expired = await signIn(user.id);
    // By the database clock, which can differ from this host's by a second or so.
    await db.update(sessions).set({ expiresAt: sql`now() - interval '2 minutes'` });
    expect((await app.request('/me', { headers: expired })).status).toBe(401);

    const live = await signIn(user.id);
    await db.update(users).set({ deletedAt: new Date().toISOString() }).where(eq(users.id, user.id));
    expect((await app.request('/me', { headers: live })).status).toBe(401);
  });
});
