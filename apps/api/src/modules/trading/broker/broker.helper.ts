import type { Tx } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { FamilyService } from '#modules/families/family/family.service';
import { ApiError } from '#utils/http/error.util';
import type { BrokerAccount } from './broker.query';
import { BrokerRepository } from './broker.repository';

export const notFound = () => new ApiError(404, 'Broker account not found');

// What the API returns: the owner is implied by the caller.
export const present = ({ ownerUserId: _owner, ...account }: BrokerAccount) => account;

export const requireOwned = async (userId: string, id: string) => {
  const account = await BrokerRepository.findOwned(id, userId);
  if (!account) throw notFound();
  return account;
};

export const audit = (tx: Tx, action: string, userId: string, accountId: string) =>
  AuditService.recordAudit(tx, {
    action,
    actorUserId: userId,
    subjectUserIds: [userId],
    targetType: 'broker_account',
    targetId: accountId,
  });

// Only a SEBI-family member (or someone with no family) may let the engine trade on stored credentials.
export async function requireMayStoreCredentials(userId: string) {
  const membership = await FamilyService.findMembership(userId);
  if (membership && !membership.canTrade) {
    throw new ApiError(403, 'Your family relationship does not allow trading on your behalf', { code: 'cannot_trade' });
  }
}
