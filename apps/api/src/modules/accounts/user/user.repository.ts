import type { UpdateProfileInput } from '@bargad/shared';
import { eq, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { brokerAccounts, brokerSecrets, passkeys, users } from '#database/schema';
import { toIso } from '#utils/time/time.util';
import { profileColumns } from './user.query';

export const UserRepository = {
  findProfile: async (userId: string, conn: Db = db) => {
    const [row] = await conn.select(profileColumns).from(users).where(eq(users.id, userId));
    return row && { ...row, createdAt: toIso(row.createdAt) };
  },

  updateProfile: async (userId: string, changes: UpdateProfileInput, conn: Db = db) => {
    const [row] = await conn.update(users).set(changes).where(eq(users.id, userId)).returning(profileColumns);
    return row && { ...row, createdAt: toIso(row.createdAt) };
  },

  findPasswordHash: async (userId: string, conn: Db = db) => {
    const [row] = await conn.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
    return row?.passwordHash;
  },

  markDeleted: async (userId: string, conn: Db = db) => {
    await conn.update(users).set({ deletedAt: sql`now()` }).where(eq(users.id, userId));
  },

  deletePasskeys: async (userId: string, conn: Db = db) => {
    await conn.delete(passkeys).where(eq(passkeys.userId, userId));
  },

  // Closes every broker account of the user and wipes the stored credentials, keeping the rows for history.
  closeBrokerAccounts: async (userId: string, conn: Db = db) => {
    const closed = await conn
      .update(brokerAccounts)
      .set({ status: 'closed' })
      .where(eq(brokerAccounts.userId, userId))
      .returning({ id: brokerAccounts.id });
    for (const { id } of closed) {
      await conn
        .update(brokerSecrets)
        .set({ credentials: null, updatedAt: sql`now()` })
        .where(eq(brokerSecrets.brokerAccountId, id));
    }
  },
};
