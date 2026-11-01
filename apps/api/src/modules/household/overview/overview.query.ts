import { type SQL, sql } from 'drizzle-orm';
import { brokerAccounts, dailyValuations, holdings } from '#database/schema';

export const investedSql = sql<string>`coalesce((
  select sum(${holdings.quantity}::numeric * ${holdings.avgCostPaise})
  from ${holdings}
  where ${holdings.brokerAccountId} = ${brokerAccounts.id}
), 0)`;

export const latestValuation = <T>(column: SQL) =>
  sql<T>`(
    select ${column}
    from ${dailyValuations}
    where ${dailyValuations.brokerAccountId} = ${brokerAccounts.id}
    order by ${dailyValuations.day} desc
    limit 1
  )`;
