import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { authChallenges, sessions, users } from '#database/schema';
import { publicUser } from './auth.query';

export const AuthRepository = {
  findUserBySessionHash: async (tokenHash: Uint8Array, conn: Db = db) => {
    const [user] = await conn
      .select(publicUser)
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          isNull(users.deletedAt),
        ),
      );
    return user;
  },

  // Undefined when a live user already has this email.
  insertUser: async (values: typeof users.$inferInsert, conn: Db = db) => {
    const [user] = await conn.insert(users).values(values).onConflictDoNothing().returning(publicUser);
    return user;
  },

  findLoginByEmail: async (email: string, conn: Db = db) => {
    const [user] = await conn
      .select({ ...publicUser, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)));
    return user;
  },

  insertSession: async (values: typeof sessions.$inferInsert, conn: Db = db) => {
    await conn.insert(sessions).values(values);
  },

  revokeSession: async (tokenHash: Uint8Array, conn: Db = db) => {
    await conn
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  },

  insertChallenge: async (values: typeof authChallenges.$inferInsert, conn: Db = db) => {
    await conn.insert(authChallenges).values(values);
  },

  // One conditional update, so of two concurrent uses only one gets a row back.
  consumeChallenge: async (purpose: string, challenge: Uint8Array, conn: Db = db) => {
    const [row] = await conn
      .update(authChallenges)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(authChallenges.purpose, purpose),
          eq(authChallenges.challenge, challenge),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: authChallenges.userId });
    return row;
  },

  consumeOtherChallenges: async (userId: string, purpose: string, conn: Db = db) => {
    await conn
      .update(authChallenges)
      .set({ usedAt: sql`now()` })
      .where(
        and(eq(authChallenges.userId, userId), eq(authChallenges.purpose, purpose), isNull(authChallenges.usedAt)),
      );
  },

  updatePasswordHash: async (userId: string, passwordHash: string, conn: Db = db) => {
    await conn.update(users).set({ passwordHash }).where(eq(users.id, userId));
  },

  revokeSessionsOfUser: async (userId: string, conn: Db = db) => {
    await conn
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  },
};
