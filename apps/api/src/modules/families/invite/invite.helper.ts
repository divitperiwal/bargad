import type { Tx } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { BrokerRepository } from '#modules/trading/broker/broker.repository';
import { ApiError } from '#utils/http/error.util';

export const inviteInvalid = () =>
  new ApiError(404, 'This invite is invalid or has expired', { code: 'invite_invalid' });

// A view-only member's broker accounts must not be traded on stored credentials (SEBI family only).
export async function removeStoredCredentials(tx: Tx, userId: string) {
  const accounts = await BrokerRepository.listOfUser(userId, tx);
  for (const account of accounts.filter((a) => a.loginMethod === 'stored_credentials')) {
    await BrokerRepository.clearCredentials(account.id, tx);
    await BrokerRepository.update(account.id, { loginMethod: 'broker_login' }, tx);
    await AuditService.recordAudit(tx, {
      action: 'credentials.removed',
      actorUserId: userId,
      subjectUserIds: [userId],
      targetType: 'broker_account',
      targetId: account.id,
    });
  }
}
