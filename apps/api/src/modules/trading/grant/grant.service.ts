import type { CreateGrantInput, ListGrantsQuery } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { PasskeyService } from '#modules/accounts/passkey/passkey.service';
import { AuditService } from '#modules/core/audit/audit.service';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { FamilyService } from '#modules/families/family/family.service';
import { cancelOpenBaskets } from '#modules/families/member/cascade.service';
import { BrokerRepository } from '#modules/trading/broker/broker.repository';
import { InstrumentRepository } from '#modules/trading/instrument/instrument.repository';
import type { User } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';
import { audit, notFound, notInFamily } from './grant.helper';
import { GrantRepository } from './grant.repository';

export const GrantService = {
  // The grantee is always the head; cheap checks run before the passkey challenge is spent.
  create: async (grantor: User, input: CreateGrantInput) => {
    const membership = await FamilyService.findMembership(grantor.id);
    if (!membership) throw notInFamily();
    if (membership.role === 'head') {
      throw new ApiError(409, 'The family head cannot give a grant', { code: 'head_cannot_grant' });
    }
    if (!membership.canTrade) {
      throw new ApiError(403, 'Your family relationship does not allow trading on your behalf', {
        code: 'cannot_trade',
      });
    }
    const head = await FamilyRepository.findHead(membership.familyId);
    if (!head) throw notInFamily();
    if (input.brokerAccountId && !(await BrokerRepository.findOwned(input.brokerAccountId, grantor.id))) {
      throw new ApiError(400, 'That broker account is not yours', { code: 'invalid_account' });
    }
    const instrumentIds = input.allowedInstrumentIds;
    if (instrumentIds && (await InstrumentRepository.findByIds(instrumentIds)).length !== instrumentIds.length) {
      throw new ApiError(400, 'One of the instruments was not found', { code: 'invalid_instrument' });
    }
    await PasskeyService.verifyStepUp({
      userId: grantor.id,
      purpose: 'grant',
      targetId: head.userId,
      assertion: input.assertion,
    });

    const { assertion: _assertion, durationMinutes, ...limits } = input;
    return withTransaction(async (tx) => {
      // The family may have changed while the grantor signed; a leave or handover committed since
      // would not revoke a grant it could not yet see.
      const locked = await FamilyRepository.lockActiveMembers(membership.familyId, [grantor.id, head.userId], tx);
      const stillGrantor = locked.find((m) => m.userId === grantor.id);
      const stillHead = locked.find((m) => m.userId === head.userId);
      if (stillGrantor?.role !== 'member' || !stillGrantor.canTrade || stillHead?.role !== 'head') {
        throw new ApiError(409, 'Your family changed while you were doing this, try again', { code: 'conflict' });
      }
      const grant = await GrantRepository.insert(
        { familyId: membership.familyId, grantorUserId: grantor.id, granteeUserId: head.userId, ...limits },
        durationMinutes,
        tx,
      );
      await audit(tx, 'grant.created', grantor.id, grant, {
        buyCapPaise: grant.buyCapPaise,
        sellCapPaise: grant.sellCapPaise,
        perOrderCapPaise: grant.perOrderCapPaise,
        expiresAt: grant.expiresAt,
      });
      return grant;
    });
  },

  list: async (userId: string, query: ListGrantsQuery) => ({ items: await GrantRepository.list(userId, query) }),

  // The grantor or an admin; anyone else is told the grant does not exist.
  revoke: async (user: User, id: string) => {
    const grant = await GrantRepository.findById(id);
    if (!grant) throw notFound();
    const reason = grant.grantorUserId === user.id ? 'member' : user.isAdmin ? 'admin' : undefined;
    if (!reason) throw notFound();
    return withTransaction(async (tx) => {
      const revoked = await GrantRepository.revoke(id, user.id, reason, tx);
      // Already revoked: answer with the grant as it stands and record nothing.
      if (!revoked) return (await GrantRepository.findById(id, tx)) ?? grant;
      await audit(tx, 'grant.revoked', user.id, revoked);
      // Baskets placed under the grant lose their consent with it.
      for (const basket of await cancelOpenBaskets(tx, { familyId: revoked.familyId, grantId: id })) {
        await AuditService.recordAudit(tx, {
          action: 'basket.cancelled',
          actorUserId: user.id,
          subjectUserIds: [...new Set([basket.ownerUserId, basket.createdBy])],
          familyId: basket.familyId,
          targetType: 'basket',
          targetId: basket.id,
        });
      }
      return revoked;
    });
  },
};
