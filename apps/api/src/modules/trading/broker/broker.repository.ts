import { and, asc, eq, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { brokerAccounts, brokerSecrets } from '#database/schema';
import { accountColumns, toAccount } from './broker.query';

export const BrokerRepository = {
  listOfUser: async (userId: string, conn: Db = db) => {
    const rows = await conn
      .select(accountColumns)
      .from(brokerAccounts)
      .where(eq(brokerAccounts.userId, userId))
      .orderBy(asc(brokerAccounts.createdAt));
    return rows.map(toAccount);
  },

  findOwned: async (id: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .select(accountColumns)
      .from(brokerAccounts)
      .where(and(eq(brokerAccounts.id, id), eq(brokerAccounts.userId, userId)));
    return row && toAccount(row);
  },

  findById: async (id: string, conn: Db = db) => {
    const [row] = await conn.select(accountColumns).from(brokerAccounts).where(eq(brokerAccounts.id, id));
    return row && toAccount(row);
  },

  // Undefined when that broker client id is already linked to an account that is not closed, by anyone.
  // The target and predicate match the partial unique index broker_accounts_client.
  insert: async (values: { userId: string; broker: string; brokerClientId: string; label: string }, conn: Db = db) => {
    const [row] = await conn
      .insert(brokerAccounts)
      .values(values)
      .onConflictDoNothing({
        target: [brokerAccounts.broker, brokerAccounts.brokerClientId],
        where: sql`status <> 'closed'`,
      })
      .returning(accountColumns);
    return row && toAccount(row);
  },

  update: async (
    id: string,
    changes: { label?: string; hidden?: boolean; loginMethod?: string; status?: string },
    conn: Db = db,
  ) => {
    const [row] = await conn
      .update(brokerAccounts)
      .set(changes)
      .where(eq(brokerAccounts.id, id))
      .returning(accountColumns);
    return row && toAccount(row);
  },

  // Writes only the columns the API role may touch, and reads nothing back.
  upsertCredentials: async (brokerAccountId: string, credentials: Uint8Array, keyVersion: number, conn: Db = db) => {
    await conn
      .insert(brokerSecrets)
      .values({ brokerAccountId, credentials, keyVersion })
      .onConflictDoUpdate({
        target: brokerSecrets.brokerAccountId,
        set: { credentials, keyVersion, updatedAt: sql`now()` },
      });
  },

  clearCredentials: async (brokerAccountId: string, conn: Db = db) => {
    await conn
      .update(brokerSecrets)
      .set({ credentials: null, updatedAt: sql`now()` })
      .where(eq(brokerSecrets.brokerAccountId, brokerAccountId));
  },
};
