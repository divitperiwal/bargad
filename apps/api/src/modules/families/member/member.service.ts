import type { DeclareRelationshipInput, HandoverInput } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { FamilyService } from '#modules/families/family/family.service';
import { ApiError } from '#utils/http/error.util';
import { CascadeRepository } from './cascade.repository';
import { cancelOpenBaskets as cancelBaskets } from './cascade.service';
import {
  conflict,
  dissolveFamily,
  endMembership,
  leaveAsMember,
  mustHandOver,
  recordMemberEvent,
} from './member.helper';

export const MemberService = {
  leave: (userId: string) =>
    withTransaction(async (tx) => {
      const me = await FamilyService.requireMembership(userId, tx);
      if (me.role === 'head') throw mustHandOver();
      await leaveAsMember(tx, me);
    }),

  remove: (headUserId: string, memberId: string) =>
    withTransaction(async (tx) => {
      const head = await FamilyService.requireHead(headUserId, tx);
      const member = await FamilyRepository.findActiveMemberById(head.familyId, memberId, tx);
      if (!member) throw new ApiError(404, 'Member not found', { code: 'not_found' });
      if (member.role === 'head') throw mustHandOver();
      await endMembership(tx, member, 'removed', headUserId);
      await recordMemberEvent(tx, 'member.removed', member, headUserId);
    }),

  handover: (headUserId: string, input: HandoverInput) =>
    withTransaction(async (tx) => {
      const head = await FamilyService.requireHead(headUserId, tx);
      const target = await FamilyRepository.findActiveMemberById(head.familyId, input.toMemberId, tx);
      if (!target) throw new ApiError(404, 'Member not found', { code: 'not_found' });
      if (target.memberId === head.memberId) {
        throw new ApiError(400, 'Choose someone else to hand over to');
      }
      // A family has one head at any moment and the unique index is not deferrable: the old head steps down first.
      await FamilyRepository.demote(head.memberId, tx);
      if (!(await FamilyRepository.promote(target.memberId, tx))) throw conflict();
      await FamilyRepository.clearRelationshipsExcept(head.familyId, [head.memberId, target.memberId], tx);
      // Invites were sent on the old head's authority.
      await FamilyRepository.revokePendingInvitesOfFamily(head.familyId, tx);
      await CascadeRepository.revokeAllGrants(head.familyId, 'handover', headUserId, tx);
      // Trading pauses until each member re-declares, so self baskets stop too.
      await cancelBaskets(tx, { familyId: head.familyId });
      const members = await FamilyRepository.listActiveMembers(head.familyId, tx);
      await AuditService.recordAudit(tx, {
        action: 'family.handover',
        actorUserId: headUserId,
        subjectUserIds: members.map((m) => m.userId),
        familyId: head.familyId,
        targetType: 'family_member',
        targetId: target.memberId,
      });
    }),

  declareRelationship: (userId: string, input: DeclareRelationshipInput) =>
    withTransaction(async (tx) => {
      const me = await FamilyService.requireMembership(userId, tx);
      const updated = await FamilyRepository.declareRelationship(me.memberId, input.relationship, tx);
      if (!updated) {
        throw new ApiError(409, 'You already declared your relationship', { code: 'relationship_already_declared' });
      }
      await recordMemberEvent(tx, 'member.relationship_declared', updated, userId);
      return updated;
    }),

  dissolve: (headUserId: string) =>
    withTransaction(async (tx) => {
      const head = await FamilyService.requireHead(headUserId, tx);
      // Locked before counting, so nobody can join between the count and the dissolve.
      await FamilyRepository.lockFamily(head.familyId, tx);
      const members = await FamilyRepository.listActiveMembers(head.familyId, tx);
      if (members.length > 1) {
        throw new ApiError(409, 'Everyone else has to leave first', { code: 'family_has_members' });
      }
      await dissolveFamily(tx, head.familyId, headUserId);
    }),
};
