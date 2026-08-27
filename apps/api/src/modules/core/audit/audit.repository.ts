import type { Db } from '#config/database.config';
import { auditLog } from '#database/schema';
import type { AuditRow } from './audit.query';

export const AuditRepository = {
  insertRows: (rows: AuditRow[], conn: Db) => conn.insert(auditLog).values(rows),
};
