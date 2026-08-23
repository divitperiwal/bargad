import { type AuthenticationResponseJSON, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { webauthnConfig } from '#config/webauthn.config';
import { PASSKEY_CHALLENGE_MS } from '#constant';
import { ApiError } from '#utils/http/error.util';
import { PasskeyRepository } from './passkey.repository';

export const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export const fromBase64url = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

export const passkeyFailed = () => new ApiError(403, 'Passkey check failed', { code: 'passkey_failed' });

export async function issueChallenge(userId: string | null, purpose: string, targetId: string | null = null) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeId = await PasskeyRepository.insertChallenge({
    userId,
    purpose,
    targetId,
    challenge,
    expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_MS).toISOString(),
  });
  return { challengeId, challenge };
}

export type StoredCredential = {
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[];
};

// The authenticator's new sign count when the assertion is valid for this challenge and passkey, else undefined.
export async function verifyAssertion(challenge: Uint8Array, response: unknown, passkey: StoredCredential) {
  const verification = await verifyAuthenticationResponse({
    response: response as AuthenticationResponseJSON,
    expectedChallenge: base64url(challenge),
    expectedOrigin: webauthnConfig.origins,
    expectedRPID: webauthnConfig.rpId,
    credential: {
      id: base64url(passkey.credentialId),
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.signCount,
      transports: passkey.transports,
    },
    requireUserVerification: true,
  }).catch(() => undefined);
  return verification?.verified ? verification.authenticationInfo.newCounter : undefined;
}

export async function credentialsOf(userId: string) {
  const rows = await PasskeyRepository.listCredentialsOfUser(userId);
  return rows.map((row) => ({ id: base64url(row.credentialId), transports: row.transports }));
}
