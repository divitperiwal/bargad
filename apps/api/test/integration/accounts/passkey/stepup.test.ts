import { describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { authChallenges } from '#database/schema';
import { PasskeyService } from '#modules/accounts/passkey/passkey.service';
import { createUser, signIn } from '#test/integration/fixtures';
import { registerPasskey, signStepUp } from '#test/integration/webauthn';

const passkeyFailed = { status: 403, code: 'passkey_failed' };

async function userWithPasskey() {
  const user = await createUser();
  const headers = await signIn(user.id);
  const { passkeyId, authenticator } = await registerPasskey(headers);
  return { userId: user.id, headers, passkeyId, authenticator };
}

describe('PasskeyService.verifyStepUp', () => {
  test('accepts a signed challenge for its purpose and target', async () => {
    const { userId, headers, passkeyId, authenticator } = await userWithPasskey();
    const targetId = crypto.randomUUID();
    const assertion = await signStepUp(headers, authenticator, 'approve', targetId);

    const result = await PasskeyService.verifyStepUp({ userId, purpose: 'approve', targetId, assertion });

    expect(result).toEqual({ passkeyId });
  });

  test('rejects the same assertion a second time', async () => {
    const { userId, headers, authenticator } = await userWithPasskey();
    const targetId = crypto.randomUUID();
    const assertion = await signStepUp(headers, authenticator, 'approve', targetId);
    await PasskeyService.verifyStepUp({ userId, purpose: 'approve', targetId, assertion });

    const again = PasskeyService.verifyStepUp({ userId, purpose: 'approve', targetId, assertion });

    await expect(again).rejects.toMatchObject(passkeyFailed);
  });

  test('rejects an assertion made for another target', async () => {
    const { userId, headers, authenticator } = await userWithPasskey();
    const assertion = await signStepUp(headers, authenticator, 'approve', crypto.randomUUID());

    const result = PasskeyService.verifyStepUp({
      userId,
      purpose: 'approve',
      targetId: crypto.randomUUID(),
      assertion,
    });

    await expect(result).rejects.toMatchObject(passkeyFailed);
  });

  test('rejects an assertion made for another purpose', async () => {
    const { userId, headers, authenticator } = await userWithPasskey();
    const targetId = crypto.randomUUID();
    const assertion = await signStepUp(headers, authenticator, 'approve', targetId);

    const result = PasskeyService.verifyStepUp({ userId, purpose: 'credentials', targetId, assertion });

    await expect(result).rejects.toMatchObject(passkeyFailed);
  });

  test('rejects another user’s authenticator', async () => {
    const asha = await userWithPasskey();
    const ravi = await userWithPasskey();
    const targetId = crypto.randomUUID();
    const assertion = await signStepUp(asha.headers, ravi.authenticator, 'approve', targetId);

    const result = PasskeyService.verifyStepUp({ userId: asha.userId, purpose: 'approve', targetId, assertion });

    await expect(result).rejects.toMatchObject(passkeyFailed);
  });

  test('rejects an expired challenge', async () => {
    const { userId, headers, authenticator } = await userWithPasskey();
    const targetId = crypto.randomUUID();
    const assertion = await signStepUp(headers, authenticator, 'approve', targetId);
    await db
      .update(authChallenges)
      .set({ expiresAt: sql`now() - interval '2 minutes'` })
      .where(eq(authChallenges.id, assertion.challengeId));

    const result = PasskeyService.verifyStepUp({ userId, purpose: 'approve', targetId, assertion });

    await expect(result).rejects.toMatchObject(passkeyFailed);
  });
});

describe('PasskeyService.verifyStepUp authenticator checks', () => {
  // Signs a fresh step-up challenge with the authenticator's per-call options.
  async function signWith(call: { origin?: string; userVerified?: boolean }) {
    const { userId, headers, authenticator } = await userWithPasskey();
    const targetId = crypto.randomUUID();
    const res = await app.request('/passkeys/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ purpose: 'approve', targetId }),
    });
    const { challengeId, options } = (await res.json()).data;
    const assertion = { challengeId, response: authenticator.authenticate(options, call) };
    return PasskeyService.verifyStepUp({ userId, purpose: 'approve', targetId, assertion });
  }

  test('rejects an assertion without user verification', async () => {
    await expect(signWith({ userVerified: false })).rejects.toMatchObject(passkeyFailed);
  });

  test('rejects an assertion signed for another origin', async () => {
    await expect(signWith({ origin: 'https://evil.example' })).rejects.toMatchObject(passkeyFailed);
  });

  test('accepts the same assertion with user verification from the real origin', async () => {
    await expect(signWith({})).resolves.toHaveProperty('passkeyId');
  });
});

describe('PasskeyService.verifyStepUp input', () => {
  test('rejects a malformed assertion with passkey_failed, not a database error', async () => {
    const { userId } = await userWithPasskey();
    const assertion = { challengeId: 'not-a-uuid', response: { id: 42 } };

    const result = PasskeyService.verifyStepUp({
      userId,
      purpose: 'approve',
      targetId: crypto.randomUUID(),
      assertion,
    });

    await expect(result).rejects.toMatchObject(passkeyFailed);
  });
});

describe('POST /passkeys/challenges', () => {
  test('answers 409 no_passkey for a user without a passkey', async () => {
    const headers = await signIn((await createUser()).id);

    const res = await app.request('/passkeys/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ purpose: 'approve', targetId: crypto.randomUUID() }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_passkey');
  });
});
