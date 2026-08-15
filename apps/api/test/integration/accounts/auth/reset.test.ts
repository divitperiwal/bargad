import { describe, expect, spyOn, test } from 'bun:test';
import { app } from '#app';
import { db } from '#config/database.config';
import { setMailer } from '#config/resend.config';
import { auditLog, authChallenges } from '#database/schema';
import { captureMail, createUserWithPassword, signIn, TEST_PASSWORD, waitForMail } from '#test/integration/fixtures';
import { hashToken } from '#utils/security/crypto.util';
import { generateToken } from '#utils/security/token.util';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('POST /auth/password/forgot', () => {
  test('mails a reset link to a known user, whatever the email casing', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    const mail = captureMail();

    const res = await post('/auth/password/forgot', { email: '  ASHA@Example.com ' });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sent: true });
    await waitForMail(mail);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.to).toBe('asha@example.com');
    expect(mail[0]?.text).toContain('/reset?token=');
  });

  test('answers an unknown email with the same body and sends no mail', async () => {
    const mail = captureMail();

    const res = await post('/auth/password/forgot', { email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sent: true });
    expect(mail).toHaveLength(0);
  });

  test('still answers 200 when the mailer fails', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    setMailer({
      send: async () => {
        throw new Error('smtp down');
      },
    });

    const logged = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await post('/auth/password/forgot', { email: 'asha@example.com' });

      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ sent: true });
    } finally {
      logged.mockRestore();
    }
  });

  test('answers without waiting for the mailer', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    setMailer({ send: () => new Promise<void>(() => {}) });

    const res = await Promise.race([
      post('/auth/password/forgot', { email: 'asha@example.com' }),
      Bun.sleep(1500).then(() => null),
    ]);

    expect(res?.status).toBe(200);
  });
});

const NEW_PASSWORD = 'a brand new password';

async function requestResetToken(email: string) {
  const mail = captureMail();
  await post('/auth/password/forgot', { email });
  await waitForMail(mail);
  const token = mail[0]?.text.match(/token=(\S+)/)?.[1];
  if (!token) throw new Error('no reset token was mailed');
  return token;
}

describe('POST /auth/password/reset', () => {
  test('sets the new password and signs every old session out', async () => {
    const user = await createUserWithPassword({ email: 'asha@example.com' });
    const session = await signIn(user.id);
    const token = await requestResetToken('asha@example.com');

    const res = await post('/auth/password/reset', { token, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ reset: true });
    const login = (password: string) => post('/auth/login', { email: 'asha@example.com', password, client: 'web' });
    expect((await login(TEST_PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    expect((await app.request('/auth/me', { headers: session })).status).toBe(401);
  });

  test('rejects the same token a second time', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    const token = await requestResetToken('asha@example.com');
    await post('/auth/password/reset', { token, password: NEW_PASSWORD });

    const res = await post('/auth/password/reset', { token, password: 'another new password' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reset_token_invalid');
  });

  test('lets exactly one of two simultaneous resets win', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    const token = await requestResetToken('asha@example.com');

    const results = await Promise.all([
      post('/auth/password/reset', { token, password: NEW_PASSWORD }),
      post('/auth/password/reset', { token, password: NEW_PASSWORD }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  test('rejects a token whose link has expired', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    const token = await requestResetToken('asha@example.com');
    await db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 60_000).toISOString() });

    const res = await post('/auth/password/reset', { token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reset_token_invalid');
  });

  test('rejects a token that belongs to another kind of challenge', async () => {
    const user = await createUserWithPassword({ email: 'asha@example.com' });
    const token = generateToken();
    await db.insert(authChallenges).values({
      userId: user.id,
      purpose: 'register',
      challenge: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await post('/auth/password/reset', { token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reset_token_invalid');
  });

  test('rejects a malformed body with 400', async () => {
    const res = await post('/auth/password/reset', { token: 'short', password: 'short' });

    expect(res.status).toBe(400);
  });

  test('records a password.reset audit event for the user', async () => {
    const user = await createUserWithPassword({ email: 'asha@example.com' });
    const token = await requestResetToken('asha@example.com');

    await post('/auth/password/reset', { token, password: NEW_PASSWORD });

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'password.reset', actorUserId: user.id, subjectUserId: user.id });
  });

  test('invalidates the other outstanding reset tokens', async () => {
    await createUserWithPassword({ email: 'asha@example.com' });
    const first = await requestResetToken('asha@example.com');
    const second = await requestResetToken('asha@example.com');

    expect((await post('/auth/password/reset', { token: first, password: NEW_PASSWORD })).status).toBe(200);

    const res = await post('/auth/password/reset', { token: second, password: 'yet another password' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reset_token_invalid');
  });
});
