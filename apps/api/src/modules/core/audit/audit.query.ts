import type { auditLog } from '#database/schema';

export type AuditRow = typeof auditLog.$inferInsert;
