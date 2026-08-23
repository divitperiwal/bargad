import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { authChallenges, passkeys, users } from '#database/schema';
import { type ChallengeMatch, publicPasskey, storedCredential, toPublic } from './passkey.query';

export const PasskeyRepository = {
  insertChallenge: async (values: typeof authChallenges.$inferInsert, conn: Db = db) => {
    const [row] = await conn.insert(authChallenges).values(values).returning({ id: authChallenges.id });
    if (!row) throw new Error('challenge insert returned nothing');
    return row.id;
  },

  // One conditional update, so a challenge is spent at most once; undefined when it is unknown, used or expired.
  consumeChallenge: async (match: ChallengeMatch, conn: Db = db) => {
    const [row] = await conn
      .update(authChallenges)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(authChallenges.id, match.id),
          match.userId ? eq(authChallenges.userId, match.userId) : isNull(authChallenges.userId),
          eq(authChallenges.purpose, match.purpose),
          match.targetId ? eq(authChallenges.targetId, match.targetId) : isNull(authChallenges.targetId),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, sql`now()`),
        ),
      )
      .returning({ challenge: authChallenges.challenge });
    return row?.challenge;
  },

  // A register challenge of this user, spent at most once. targetId is the user's own id when the
  // challenge was issued after a passkey_manage step-up, else null.
  consumeRegisterChallenge: async (id: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .update(authChallenges)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(authChallenges.id, id),
          eq(authChallenges.userId, userId),
          eq(authChallenges.purpose, 'register'),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, sql`now()`),
        ),
      )
      .returning({ challenge: authChallenges.challenge, targetId: authChallenges.targetId });
    return row;
  },

  // Locks the user's row, so registrations for one user run one at a time, and counts their passkeys.
  lockUserAndCountPasskeys: async (userId: string, conn: Db) => {
    await conn.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [row] = await conn
      .select({ count: sql<number>`count(*)::int` })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
    return row?.count ?? 0;
  },

  listCredentialsOfUser: (userId: string, conn: Db = db) =>
    conn
      .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt)),

  insertPasskey: async (values: typeof passkeys.$inferInsert, conn: Db = db) => {
    const [row] = await conn.insert(passkeys).values(values).returning(publicPasskey);
    if (!row) throw new Error('passkey insert returned nothing');
    return toPublic(row);
  },

  // The passkey and its owner, for signing in; undefined for an unknown credential or a deleted user.
  findForLogin: async (credentialId: Uint8Array, conn: Db = db) => {
    const [row] = await conn
      .select({
        passkey: storedCredential,
        user: { id: users.id, email: users.email, displayName: users.displayName, isAdmin: users.isAdmin },
      })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.userId))
      .where(and(eq(passkeys.credentialId, credentialId), isNull(users.deletedAt)));
    return row;
  },

  findOfUser: async (credentialId: Uint8Array, userId: string, conn: Db = db) => {
    const [row] = await conn
      .select(storedCredential)
      .from(passkeys)
      .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)));
    return row;
  },

  markUsed: async (id: string, signCount: number, conn: Db = db) => {
    await conn.update(passkeys).set({ signCount, lastUsedAt: sql`now()` }).where(eq(passkeys.id, id));
  },

  listOfUser: async (userId: string, conn: Db = db) => {
    const rows = await conn
      .select(publicPasskey)
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt));
    return rows.map(toPublic);
  },

  // Undefined when the passkey is missing or belongs to someone else.
  rename: async (id: string, userId: string, name: string, conn: Db = db) => {
    const [row] = await conn
      .update(passkeys)
      .set({ name })
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .returning(publicPasskey);
    return row && toPublic(row);
  },

  delete: async (id: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .returning({ id: passkeys.id });
    return row;
  },
};
