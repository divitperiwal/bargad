import type { DeleteAccountInput, UpdateProfileInput } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { AuthRepository } from '#modules/accounts/auth/auth.repository';
import { AuditService } from '#modules/core/audit/audit.service';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { FamilyService } from '#modules/families/family/family.service';
import { dissolveFamily, leaveAsMember, mustHandOver } from '#modules/families/member/member.helper';
import { ApiError } from '#utils/http/error.util';
import { UserRepository } from './user.repository';

export const UserService = {
  getProfile: async (userId: string) => {
    const user = await UserRepository.findProfile(userId);
    if (!user) throw new ApiError(404, 'User not found');
    return user;
  },

  updateProfile: async (userId: string, input: UpdateProfileInput) => {
    const user = await UserRepository.updateProfile(userId, input);
    if (!user) throw new ApiError(404, 'User not found');
    return user;
  },

  deleteAccount: async (userId: string, input: DeleteAccountInput) => {
    const hash = await UserRepository.findPasswordHash(userId);
    if (!hash || !(await Bun.password.verify(input.password, hash))) {
      throw new ApiError(401, 'Wrong password', { code: 'invalid_credentials' });
    }
    await withTransaction(async (tx) => {
      const me = await FamilyService.findMembership(userId, tx);
      if (me?.role === 'head') {
        // Same rule as leaving: a head with other members hands the family over first.
        const members = await FamilyRepository.listActiveMembers(me.familyId, tx);
        if (members.some((m) => m.userId !== userId)) throw mustHandOver();
        await dissolveFamily(tx, me.familyId, userId);
      } else if (me) await leaveAsMember(tx, me);

      await UserRepository.markDeleted(userId, tx);
      await AuthRepository.revokeSessionsOfUser(userId, tx);
      await UserRepository.deletePasskeys(userId, tx);
      await UserRepository.closeBrokerAccounts(userId, tx);
      await AuditService.recordAudit(tx, {
        action: 'user.deleted',
        actorUserId: userId,
        subjectUserIds: [userId],
        targetType: 'user',
        targetId: userId,
      });
    });
  },
};
