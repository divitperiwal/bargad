import {
  assertionSchema,
  type ManagePasskeyInput,
  type PasskeyLoginInput,
  type RegisterPasskeyInput,
  type RenamePasskeyInput,
  type StepUpChallengeInput,
  type StepUpPurpose,
} from '@bargad/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { withTransaction } from '#config/database.config';
import { webauthnConfig } from '#config/webauthn.config';
import type { SignedIn } from '#modules/accounts/auth/auth.helper';
import { AuthService } from '#modules/accounts/auth/auth.service';
import { AuditService } from '#modules/core/audit/audit.service';
import type { User } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';
import {
  base64url,
  credentialsOf,
  fromBase64url,
  issueChallenge,
  passkeyFailed,
  verifyAssertion,
} from './passkey.helper';
import { PasskeyRepository } from './passkey.repository';

// Someone holding only the password must not be able to add or remove passkeys, so once the user
// has one, the change needs a step-up from an existing passkey. The very first needs only the session.
// True when the step-up was needed and passed, false for a user with no passkey yet.
async function requireManageStepUp(userId: string, input: ManagePasskeyInput) {
  if ((await PasskeyRepository.listCredentialsOfUser(userId)).length === 0) return false;
  await PasskeyService.verifyStepUp({
    userId,
    purpose: 'passkey_manage',
    targetId: userId,
    assertion: input.assertion,
  });
  return true;
}

export const PasskeyService = {
  // A challenge issued after a step-up carries the user's own id as its target; register uses
  // that to tell it from a first-passkey challenge.
  registrationOptions: async (user: User, input: ManagePasskeyInput = {}) => {
    const steppedUp = await requireManageStepUp(user.id, input);
    const { challengeId, challenge } = await issueChallenge(user.id, 'register', steppedUp ? user.id : null);
    const options = await generateRegistrationOptions({
      rpName: webauthnConfig.rpName,
      rpID: webauthnConfig.rpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.displayName,
      challenge,
      attestationType: 'none',
      excludeCredentials: await credentialsOf(user.id),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return { challengeId, options };
  },

  register: async (userId: string, input: RegisterPasskeyInput) => {
    const consumed = await PasskeyRepository.consumeRegisterChallenge(input.challengeId, userId);
    if (!consumed) throw passkeyFailed();

    const verification = await verifyRegistrationResponse({
      response: input.response as unknown as RegistrationResponseJSON,
      expectedChallenge: base64url(consumed.challenge),
      expectedOrigin: webauthnConfig.origins,
      expectedRPID: webauthnConfig.rpId,
      requireUserVerification: true,
    }).catch(() => undefined);
    if (!verification?.verified) throw passkeyFailed();

    const { credential } = verification.registrationInfo;
    return withTransaction(async (tx) => {
      // Whether a passkey exists is decided now, not when the challenge was issued: a challenge from
      // before the first passkey, or a second first-registration racing this one, must not add another.
      const existing = await PasskeyRepository.lockUserAndCountPasskeys(userId, tx);
      if (existing > 0 && consumed.targetId !== userId) throw passkeyFailed();
      const passkey = await PasskeyRepository.insertPasskey(
        {
          userId,
          credentialId: fromBase64url(credential.id),
          publicKey: credential.publicKey,
          signCount: credential.counter,
          transports: credential.transports ?? [],
          name: input.name,
        },
        tx,
      );
      await AuditService.recordAudit(tx, {
        action: 'passkey.added',
        actorUserId: userId,
        subjectUserIds: [userId],
        targetType: 'passkey',
        targetId: passkey.id,
      });
      return passkey;
    });
  },

  // Usernameless sign-in: no user yet, so the browser offers any passkey it has for this site.
  loginOptions: async () => {
    const { challengeId, challenge } = await issueChallenge(null, 'login');
    const options = await generateAuthenticationOptions({
      rpID: webauthnConfig.rpId,
      challenge,
      userVerification: 'required',
      allowCredentials: [],
    });
    return { challengeId, options };
  },

  login: async (input: PasskeyLoginInput): Promise<SignedIn> => {
    const loginFailed = () => new ApiError(401, 'Passkey check failed', { code: 'passkey_failed' });
    const challenge = await PasskeyRepository.consumeChallenge({
      id: input.challengeId,
      userId: null,
      purpose: 'login',
      targetId: null,
    });
    if (!challenge) throw loginFailed();

    const found = await PasskeyRepository.findForLogin(fromBase64url(input.response.id));
    if (!found) throw loginFailed();
    const signCount = await verifyAssertion(challenge, input.response, found.passkey);
    if (signCount === undefined) throw loginFailed();

    return withTransaction(async (tx) => {
      await PasskeyRepository.markUsed(found.passkey.id, signCount, tx);
      return { user: found.user, ...(await AuthService.createSession(found.user.id, input.client, tx)) };
    });
  },

  stepUpChallenge: async (userId: string, input: StepUpChallengeInput) => {
    const allowCredentials = await credentialsOf(userId);
    if (allowCredentials.length === 0) {
      throw new ApiError(409, 'Add a passkey first', { code: 'no_passkey' });
    }
    const { challengeId, challenge } = await issueChallenge(userId, input.purpose, input.targetId);
    const options = await generateAuthenticationOptions({
      rpID: webauthnConfig.rpId,
      challenge,
      userVerification: 'required',
      allowCredentials,
    });
    return { challengeId, options };
  },

  // Gates a consent action. The challenge is spent on db, outside any caller transaction,
  // so it stays spent even when the action it guards fails afterwards.
  verifyStepUp: async (input: {
    userId: string;
    purpose: StepUpPurpose;
    targetId: string;
    // Parsed here, so a missing or malformed assertion is a failed check rather than a crash.
    assertion: unknown;
  }): Promise<{ passkeyId: string }> => {
    const assertion = assertionSchema.safeParse(input.assertion);
    if (!assertion.success) throw passkeyFailed();
    const challenge = await PasskeyRepository.consumeChallenge({
      id: assertion.data.challengeId,
      userId: input.userId,
      purpose: input.purpose,
      targetId: input.targetId,
    });
    if (!challenge) throw passkeyFailed();

    const { response } = assertion.data;
    const passkey = await PasskeyRepository.findOfUser(fromBase64url(response.id), input.userId);
    if (!passkey) throw passkeyFailed();
    const signCount = await verifyAssertion(challenge, response, passkey);
    if (signCount === undefined) throw passkeyFailed();

    await PasskeyRepository.markUsed(passkey.id, signCount);
    return { passkeyId: passkey.id };
  },

  list: (userId: string) => PasskeyRepository.listOfUser(userId),

  rename: async (userId: string, id: string, input: RenamePasskeyInput) => {
    const passkey = await PasskeyRepository.rename(id, userId, input.name);
    if (!passkey) throw new ApiError(404, 'Passkey not found');
    return passkey;
  },

  remove: async (userId: string, id: string, input: ManagePasskeyInput = {}) => {
    await requireManageStepUp(userId, input);
    await withTransaction(async (tx) => {
      const removed = await PasskeyRepository.delete(id, userId, tx);
      if (!removed) throw new ApiError(404, 'Passkey not found');
      await AuditService.recordAudit(tx, {
        action: 'passkey.removed',
        actorUserId: userId,
        subjectUserIds: [userId],
        targetType: 'passkey',
        targetId: id,
      });
    });
  },
};
