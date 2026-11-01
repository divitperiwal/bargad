import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { brokerAccounts, dailyValuations, holdings, instruments, users } from '#database/schema';
import { investedSql, latestValuation } from './overview.query';

export const OverviewRepository = {
  findUserName: async (userId: string, conn: Db = db) => {
    const [row] = await conn.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
    return row?.displayName;
  },

  // Open accounts of the given users as `viewerId` may see them: other members' hidden accounts are left out here.
  // Market value is the latest daily valuation, or cost when there is none yet.
  listAccountsForUsers: async (userIds: string[], viewerId: string, conn: Db = db) => {
    const rows = await conn
      .select({
        id: brokerAccounts.id,
        userId: brokerAccounts.userId,
        broker: brokerAccounts.broker,
        label: brokerAccounts.label,
        hidden: brokerAccounts.hidden,
        invested: investedSql,
        valued: latestValuation<string | null>(sql`${dailyValuations.marketValuePaise}`),
        valuedOn: latestValuation<string | null>(sql`${dailyValuations.day}::text`),
      })
      .from(brokerAccounts)
      .where(
        and(
          inArray(brokerAccounts.userId, userIds),
          ne(brokerAccounts.status, 'closed'),
          or(eq(brokerAccounts.hidden, false), eq(brokerAccounts.userId, viewerId)),
        ),
      )
      .orderBy(asc(brokerAccounts.createdAt));
    return rows.map(({ invested, valued, ...row }) => {
      const investedPaise = Number(invested);
      return { ...row, investedPaise, marketValuePaise: valued === null ? investedPaise : Number(valued) };
    });
  },

  listHoldings: (accountIds: string[], conn: Db = db) =>
    conn
      .select({
        brokerAccountId: holdings.brokerAccountId,
        instrumentId: holdings.instrumentId,
        tradingSymbol: instruments.tradingSymbol,
        name: instruments.name,
        quantity: holdings.quantity,
        avgCostPaise: holdings.avgCostPaise,
      })
      .from(holdings)
      .innerJoin(instruments, eq(instruments.id, holdings.instrumentId))
      .where(inArray(holdings.brokerAccountId, accountIds))
      .orderBy(asc(instruments.tradingSymbol)),
};
