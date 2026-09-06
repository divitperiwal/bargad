import type { Tx } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import type { Membership } from '#modules/families/family/family.query';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { ApiError } from '#utils/http/error.util';
import { CascadeRepository } from './cascade.repository';
import { cancelOpenBaskets as cancelBaskets } from './cascade.service';

export const mustHandOver = () =>
  new ApiError(409, 'Hand the family over to someone else first', { code: 'head_must_hand_over' });

export const conflict = () =>
  new ApiError(409, 'That changed while you were doing it, try again', { code: 'conflict' });

// An event about one member, visible to that member and to the head.
export async function recordMemberEvent(tx: Tx, action: string, member: Membership, actorUserId: string) {
  const head = await FamilyRepository.findHead(member.familyId, tx);
  await AuditService.recordAudit(tx, {
    action,
    actorUserId,
    subjectUserIds: [...new Set([member.userId, ...(head ? [head.userId] : [])])],
    familyId: member.familyId,
    targetType: 'family_member',
    targetId: member.memberId,
  });
}

// The member's row, grants and baskets; the audit event is recorded by the caller.
export async function endMembership(tx: Tx, member: Membership, reason: 'left' | 'removed', revokedBy: string) {
  if (!(await FamilyRepository.markLeft(member.memberId, reason, tx))) throw conflict();
  await CascadeRepository.revokeGrantsOfUser(member.familyId, member.userId, reason, revokedBy, tx);
  await cancelBaskets(tx, { familyId: member.familyId, ownerUserId: member.userId });
}

// Ends every membership in the family, then the family itself. The family lock makes an invite
// acceptance in flight either finish first (and its member is ended here) or wait and find it dissolved.
export async function dissolveFamily(tx: Tx, familyId: string, actorUserId: string) {
  await FamilyRepository.lockFamily(familyId, tx);
  const members = await FamilyRepository.listActiveMembers(familyId, tx);
  await FamilyRepository.markAllLeft(familyId, 'dissolved', tx);
  await FamilyRepository.markDissolved(familyId, tx);
  await FamilyRepository.revokePendingInvitesOfFamily(familyId, tx);
  await CascadeRepository.revokeAllGrants(familyId, 'left', actorUserId, tx);
  await cancelBaskets(tx, { familyId });
  await AuditService.recordAudit(tx, {
    action: 'family.dissolved',
    actorUserId,
    subjectUserIds: members.map((m) => m.userId),
    familyId,
    targetType: 'family',
    targetId: familyId,
  });
}

// A non-head leaving, shared by the leave endpoint and account deletion.
export async function leaveAsMember(tx: Tx, member: Membership) {
  await endMembership(tx, member, 'left', member.userId);
  await recordMemberEvent(tx, 'member.left', member, member.userId);
}
