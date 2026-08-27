import { expect, test } from 'bun:test';
import { db, withTransaction } from '#config/database.config';
import { auditLog } from '#database/schema';
import { AuditService } from '#modules/core/audit/audit.service';
import { createUser } from '#test/integration/fixtures';

test('recordAudit writes one row per subject and rolls back with its transaction', async () => {
  const [a, b] = [await createUser(), await createUser()];
  await withTransaction((tx) =>
    AuditService.recordAudit(tx, { action: 'test.done', actorUserId: a.id, subjectUserIds: [a.id, b.id] }),
  );
  expect(await db.select().from(auditLog)).toHaveLength(2);

  await db
    .transaction(async (tx) => {
      await AuditService.recordAudit(tx, { action: 'test.undone', actorUserId: null, subjectUserIds: [a.id] });
      tx.rollback();
    })
    .catch(() => {});
  expect(await db.select().from(auditLog)).toHaveLength(2);
});
