import type { Tx } from '#config/database.config';
import { AuditRepository } from './audit.repository';
import type { AuditEvent } from './audit.types';

export const AuditService = {
  // Takes a transaction so the audit rows commit or roll back with the change they record.
  recordAudit: (tx: Tx, event: AuditEvent) => {
    const { subjectUserIds, ...shared } = event;
    const rows = subjectUserIds.map((subjectUserId) => ({ ...shared, subjectUserId }));
    return AuditRepository.insertRows(rows, tx);
  },
};
