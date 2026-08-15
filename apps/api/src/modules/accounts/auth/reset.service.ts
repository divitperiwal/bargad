import type { ForgotPasswordInput, ResetPasswordInput } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { logger } from '#config/logger.config';
import { getMailer } from '#config/resend.config';
import { PASSWORD_RESET_MINUTES, WEB_ORIGIN } from '#constant';
import { AuditService } from '#modules/core/audit/audit.service';
import { ApiError } from '#utils/http/error.util';
import { hashToken } from '#utils/security/crypto.util';
import { generateToken } from '#utils/security/token.util';
import { AuthRepository } from './auth.repository';

export const ResetService = {
  // Says nothing about whether the email exists or whether the mail went out.
  forgot: async (input: ForgotPasswordInput) => {
    const user = await AuthRepository.findLoginByEmail(input.email);
    if (!user) return;
    const token = generateToken();
    // Not awaited: waiting would make a known email slower than an unknown one.
    AuthRepository.insertChallenge({
      userId: user.id,
      purpose: 'password_reset',
      challenge: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_MINUTES * 60_000).toISOString(),
    })
      .then(() =>
        getMailer().send({
          to: input.email,
          subject: 'Reset your Bargad password',
          text: `Reset your password within ${PASSWORD_RESET_MINUTES} minutes: ${WEB_ORIGIN}/reset?token=${token}`,
        }),
      )
      .catch((error) => logger.error({ err: error }, 'password reset mail failed'));
  },

  reset: async (input: ResetPasswordInput) => {
    const passwordHash = await Bun.password.hash(input.password, 'argon2id');
    await withTransaction(async (tx) => {
      const challenge = await AuthRepository.consumeChallenge('password_reset', hashToken(input.token), tx);
      if (!challenge?.userId) {
        throw new ApiError(400, 'This reset link is invalid or has expired', { code: 'reset_token_invalid' });
      }
      await AuthRepository.updatePasswordHash(challenge.userId, passwordHash, tx);
      await AuthRepository.consumeOtherChallenges(challenge.userId, 'password_reset', tx);
      await AuthRepository.revokeSessionsOfUser(challenge.userId, tx);
      await AuditService.recordAudit(tx, {
        action: 'password.reset',
        actorUserId: challenge.userId,
        subjectUserIds: [challenge.userId],
      });
    });
  },
};
