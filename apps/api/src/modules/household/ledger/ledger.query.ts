import { and, eq, isNull } from 'drizzle-orm';
import { ledgerEntries } from '#database/schema';
import { toIso } from '#utils/time/time.util';

export const columns = {
  id: ledgerEntries.id,
  kind: ledgerEntries.kind,
  type: ledgerEntries.type,
  name: ledgerEntries.name,
  valuePaise: ledgerEntries.valuePaise,
  asOf: ledgerEntries.asOf,
  emiPaise: ledgerEntries.emiPaise,
  interestRateBps: ledgerEntries.interestRateBps,
  hidden: ledgerEntries.hidden,
  createdAt: ledgerEntries.createdAt,
  updatedAt: ledgerEntries.updatedAt,
};

export type Row = {
  id: string;
  kind: string;
  type: string;
  name: string;
  valuePaise: number;
  asOf: string;
  emiPaise: number | null;
  interestRateBps: number | null;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LedgerEntry = ReturnType<typeof toEntry<Row>>;

export const toEntry = <R extends Row>(row: R) => ({
  ...row,
  kind: row.kind as 'asset' | 'liability',
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

export const live = (userId: string) => and(eq(ledgerEntries.userId, userId), isNull(ledgerEntries.deletedAt));
