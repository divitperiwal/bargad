import type { SetKillSwitchInput } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { BrokerRepository } from '#modules/trading/broker/broker.repository';
import { ApiError } from '#utils/http/error.util';
import { AdminRepository } from './admin.repository';

export const AdminService = {
  listKillSwitches: () => AdminRepository.listKillSwitches(),

  setKillSwitch: (adminUserId: string, input: SetKillSwitchInput) =>
    withTransaction(async (tx) => {
      if (input.scope === 'family' && !(await AdminRepository.familyExists(input.scopeKey, tx))) {
        throw new ApiError(400, 'Invalid request', { issues: { scopeKey: ['No such family'] } });
      }
      const killSwitch = await AdminRepository.upsertKillSwitch({ ...input, changedBy: adminUserId }, tx);
      await AuditService.recordAudit(tx, {
        action: input.engaged ? 'kill_switch.engaged' : 'kill_switch.released',
        actorUserId: adminUserId,
        subjectUserIds: [adminUserId],
        targetType: 'kill_switch',
        detail: { scope: input.scope, scopeKey: input.scopeKey, reason: input.reason },
      });
      return killSwitch;
    }),

  // Wipes stored credentials and sends the owner back to broker login.
  revokeCredentials: (adminUserId: string, accountId: string) =>
    withTransaction(async (tx) => {
      const account = await BrokerRepository.findById(accountId, tx);
      if (!account) throw new ApiError(404, 'Broker account not found');
      await BrokerRepository.clearCredentials(accountId, tx);
      await BrokerRepository.update(accountId, { loginMethod: 'broker_login', status: 'needs_relink' }, tx);
      await AuditService.recordAudit(tx, {
        action: 'credentials.revoked_by_admin',
        actorUserId: adminUserId,
        subjectUserIds: [account.ownerUserId],
        targetType: 'broker_account',
        targetId: accountId,
      });
      return { revoked: true };
    }),
};
