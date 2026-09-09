import type { CreateFamilyInput } from '@bargad/shared';
import { type Db, withTransaction } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { ApiError } from '#utils/http/error.util';
import { notInFamily } from './family.helper';
import type { Membership } from './family.query';
import { FamilyRepository } from './family.repository';

export const FamilyService = {
  findMembership: (userId: string, conn?: Db): Promise<Membership | undefined> =>
    FamilyRepository.findActiveMemberOfUser(userId, conn),

  requireMembership: async (userId: string, conn?: Db): Promise<Membership> => {
    const me = await FamilyService.findMembership(userId, conn);
    if (!me) throw notInFamily();
    return me;
  },

  requireHead: async (userId: string, conn?: Db): Promise<Membership> => {
    const me = await FamilyService.requireMembership(userId, conn);
    if (me.role !== 'head') throw new ApiError(403, 'Only the family head can do this', { code: 'not_head' });
    return me;
  },

  create: (userId: string, input: CreateFamilyInput) =>
    withTransaction(async (tx) => {
      if (await FamilyService.findMembership(userId, tx)) {
        throw new ApiError(409, 'You are already in a family', { code: 'already_in_family' });
      }
      const family = await FamilyRepository.insertFamily(input.name, tx);
      const me = await FamilyRepository.insertMember(
        { familyId: family.id, userId, role: 'head', relationship: 'self' },
        tx,
      );
      await AuditService.recordAudit(tx, {
        action: 'family.created',
        actorUserId: userId,
        subjectUserIds: [userId],
        familyId: family.id,
        targetType: 'family',
        targetId: family.id,
      });
      return { family, me };
    }),

  current: async (userId: string) => {
    const me = await FamilyService.requireMembership(userId);
    const family = await FamilyRepository.findFamily(me.familyId);
    if (!family) throw notInFamily();
    const members = await FamilyRepository.listActiveMembers(me.familyId);
    return { family, me, members };
  },
};
