import type { Tx } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { ApiError } from '#utils/http/error.util';
import type { Grant } from './grant.repository';

export const notInFamily = () => new ApiError(404, 'You are not in a family', { code: 'not_in_family' });

export const notFound = () => new ApiError(404, 'Grant not found');

export const audit = (tx: Tx, action: string, actorUserId: string, grant: Grant, detail?: Record<string, unknown>) =>
  AuditService.recordAudit(tx, {
    action,
    actorUserId,
    subjectUserIds: [grant.grantorUserId, grant.granteeUserId],
    familyId: grant.familyId,
    targetType: 'grant',
    targetId: grant.id,
    detail,
  });
