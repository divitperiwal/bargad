import type { InviteMemberInput } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { logger } from '#config/logger.config';
import { getMailer } from '#config/resend.config';
import { WEB_ORIGIN } from '#constant';
import { AuditService } from '#modules/core/audit/audit.service';
import type { Relationship } from '#modules/families/family/family.query';
import { FamilyRepository } from '#modules/families/family/family.repository';
import { FamilyService } from '#modules/families/family/family.service';
import type { User } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';
import { hashToken } from '#utils/security/crypto.util';
import { generateToken } from '#utils/security/token.util';
import { inviteInvalid, removeStoredCredentials } from './invite.helper';

export const InviteService = {
  send: async (user: User, input: InviteMemberInput) => {
    const token = generateToken();
    const { invite, familyName } = await withTransaction(async (tx) => {
      const me = await FamilyService.requireHead(user.id, tx);
      if (input.email === user.email.toLowerCase()) {
        throw new ApiError(400, 'You cannot invite yourself', { code: 'cannot_invite_self' });
      }
      if (await FamilyRepository.findActiveMemberByEmail(me.familyId, input.email, tx)) {
        throw new ApiError(409, 'That person is already in your family', { code: 'already_member' });
      }
      await FamilyRepository.revokePendingByEmail(me.familyId, input.email, tx);
      const invite = await FamilyRepository.insertInvite(
        {
          familyId: me.familyId,
          invitedBy: user.id,
          email: input.email,
          relationship: input.relationship,
          tokenHash: hashToken(token),
        },
        tx,
      );
      await AuditService.recordAudit(tx, {
        action: 'invite.sent',
        actorUserId: user.id,
        subjectUserIds: [user.id],
        familyId: me.familyId,
        targetType: 'invite',
        targetId: invite.id,
        detail: { email: input.email, relationship: input.relationship },
      });
      const family = await FamilyRepository.findFamily(me.familyId, tx);
      return { invite, familyName: family?.name ?? '' };
    });
    // The database sets the expiry, so the mail quotes the row instead of a second constant.
    const acceptBy = new Date(invite.expiresAt).toLocaleDateString('en-IN', {
      dateStyle: 'long',
      timeZone: 'Asia/Kolkata',
    });
    // Not awaited: a slow mail server should not hold up the response.
    getMailer()
      .send({
        to: input.email,
        subject: `${user.displayName} invited you to join ${familyName} on Bargad`,
        text: `${user.displayName} invited you to join the ${familyName} family on Bargad. Accept by ${acceptBy}: ${WEB_ORIGIN}/invite?token=${token}`,
      })
      .catch((error) => logger.error({ err: error }, 'invite mail failed'));
    return invite;
  },

  listPending: async (userId: string) => {
    const me = await FamilyService.requireHead(userId);
    return FamilyRepository.listPendingInvites(me.familyId);
  },

  revoke: (userId: string, inviteId: string) =>
    withTransaction(async (tx) => {
      const me = await FamilyService.requireHead(userId, tx);
      const invite = await FamilyRepository.revokeInvite(inviteId, me.familyId, tx);
      if (!invite) throw new ApiError(404, 'Invite not found', { code: 'invite_not_found' });
      await AuditService.recordAudit(tx, {
        action: 'invite.revoked',
        actorUserId: userId,
        subjectUserIds: [userId],
        familyId: me.familyId,
        targetType: 'invite',
        targetId: invite.id,
        detail: { email: invite.email },
      });
    }),

  preview: async (token: string) => {
    const invite = await FamilyRepository.findOpenInviteByHash(hashToken(token));
    if (!invite) throw inviteInvalid();
    const { familyName, invitedByName, relationship, email, expiresAt } = invite;
    return { familyName, invitedByName, relationship, email, expiresAt };
  },

  accept: (user: User, token: string) =>
    withTransaction(async (tx) => {
      const found = await FamilyRepository.findOpenInviteByHash(hashToken(token), tx);
      if (!found) throw inviteInvalid();
      // A dissolve or another acceptance holds this lock until it commits, so once we have it the
      // family may be dissolved or the invite spent: check both again.
      if (!(await FamilyRepository.lockFamily(found.familyId, tx))) throw inviteInvalid();
      const invite = await FamilyRepository.findOpenInviteByHash(hashToken(token), tx);
      if (!invite) throw inviteInvalid();
      if (invite.email !== user.email.toLowerCase()) {
        throw new ApiError(403, 'This invite was sent to a different email address', {
          code: 'invite_email_mismatch',
        });
      }
      if (await FamilyService.findMembership(user.id, tx)) {
        throw new ApiError(409, 'You are already in a family', { code: 'already_in_family' });
      }
      if (!(await FamilyRepository.markInviteAccepted(invite.id, user.id, tx))) throw inviteInvalid();
      const me = await FamilyRepository.insertMember(
        {
          familyId: invite.familyId,
          userId: user.id,
          role: 'member',
          relationship: invite.relationship as Relationship,
        },
        tx,
      );
      // The head may have changed since the invite was sent; tell whoever heads the family now.
      const head = await FamilyRepository.findHead(invite.familyId, tx);
      await AuditService.recordAudit(tx, {
        action: 'member.joined',
        actorUserId: user.id,
        subjectUserIds: [...(head ? [head.userId] : []), user.id],
        familyId: invite.familyId,
        targetType: 'family_member',
        targetId: me.memberId,
        detail: { relationship: invite.relationship },
      });
      if (!me.canTrade) await removeStoredCredentials(tx, user.id);
      const family = await FamilyRepository.findFamily(invite.familyId, tx);
      return { family, me };
    }),
};
