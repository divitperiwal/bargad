import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { grants } from '#database/schema';
import { grantColumns, headSeesGrant, type NewGrant, type RevokeReason, status, toGrant } from './grant.query';

export const GrantRepository = {
  // Starts now and ends durationMinutes later, both by the database clock.
  insert: async (values: NewGrant, durationMinutes: number, conn: Db = db) => {
    const [row] = await conn
      .insert(grants)
      .values({
        ...values,
        startsAt: sql`now()`,
        expiresAt: sql`now() + make_interval(mins => ${durationMinutes}::int)`,
      })
      .returning(grantColumns);
    if (!row) throw new Error('grant insert returned nothing');
    return toGrant(row);
  },

  findById: async (id: string, conn: Db = db) => {
    const [row] = await conn.select(grantColumns).from(grants).where(eq(grants.id, id));
    return row && toGrant(row);
  },

  // The grant a head names for a basket, held FOR SHARE so a revocation waits for the basket to commit.
  findForBasket: async (id: string, granteeUserId: string, grantorUserId: string, conn: Db = db) => {
    const [row] = await conn
      .select({
        ...grantColumns,
        inWindow: sql<boolean>`${grants.revokedAt} is null and ${grants.startsAt} <= now() and now() < ${grants.expiresAt}`,
      })
      .from(grants)
      .where(and(eq(grants.id, id), eq(grants.granteeUserId, granteeUserId), eq(grants.grantorUserId, grantorUserId)))
      .for('share');
    return row && toGrant(row);
  },

  list: async (viewerId: string, query: { role: 'grantor' | 'grantee'; active?: boolean }, conn: Db = db) => {
    const rows = await conn
      .select(grantColumns)
      .from(grants)
      .where(
        and(
          query.role === 'grantor'
            ? eq(grants.grantorUserId, viewerId)
            : and(eq(grants.granteeUserId, viewerId), headSeesGrant(viewerId)),
          query.active ? sql`${status} = 'active'` : undefined,
        ),
      )
      .orderBy(desc(grants.createdAt), desc(grants.id));
    return rows.map(toGrant);
  },

  // Undefined when the grant was already revoked, so two revocations cannot both win.
  revoke: async (id: string, revokedBy: string, reason: RevokeReason, conn: Db = db) => {
    const [row] = await conn
      .update(grants)
      .set({ revokedAt: sql`now()`, revokedBy, revokeReason: reason })
      .where(and(eq(grants.id, id), isNull(grants.revokedAt)))
      .returning(grantColumns);
    return row && toGrant(row);
  },
};

export type Grant = Awaited<ReturnType<typeof GrantRepository.insert>>;
