import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { auditLog, users } from '#database/schema';
import { toIso } from '#utils/time/time.util';
import { actor, type FeedCursor } from './feed.query';

export const FeedRepository = {
  // Keyset page ordered by (at, id) descending. The cursor's `at` goes back as text so Postgres compares it at full
  // microsecond precision; `cursorAt` in the result is that raw text.
  findPage: async (userId: string, limit: number, after: FeedCursor | undefined, conn: Db = db) => {
    const rows = await conn
      .select({
        id: auditLog.id,
        at: auditLog.at,
        cursorAt: sql<string>`${auditLog.at}::text`,
        action: auditLog.action,
        actorUserId: auditLog.actorUserId,
        actorName: actor.displayName,
        familyId: auditLog.familyId,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        detail: auditLog.detail,
      })
      .from(auditLog)
      .leftJoin(actor, eq(actor.id, auditLog.actorUserId))
      .where(
        and(
          eq(auditLog.subjectUserId, userId),
          after ? sql`(${auditLog.at}, ${auditLog.id}) < (${after.at}::timestamptz, ${after.id}::bigint)` : undefined,
        ),
      )
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit + 1);
    return rows.map(({ id, at, ...row }) => ({ ...row, id: String(id), at: toIso(at) }));
  },

  countUnread: async (userId: string, conn: Db = db) => {
    const [row] = await conn
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.subjectUserId))
      .where(and(eq(auditLog.subjectUserId, userId), or(isNull(users.feedSeenAt), gt(auditLog.at, users.feedSeenAt))));
    return row?.count ?? 0;
  },

  markSeen: async (userId: string, conn: Db = db) => {
    const [row] = await conn
      .update(users)
      .set({ feedSeenAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning({ seenAt: users.feedSeenAt });
    if (!row?.seenAt) throw new Error('feed marker update returned nothing');
    return toIso(row.seenAt);
  },
};
