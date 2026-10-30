import type { LedgerEntryInput } from '@bargad/shared';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { ledgerEntries } from '#database/schema';
import { columns, live, toEntry } from './ledger.query';

export const LedgerRepository = {
  listOfUser: async (userId: string, conn: Db = db) => {
    const rows = await conn
      .select(columns)
      .from(ledgerEntries)
      .where(live(userId))
      .orderBy(asc(ledgerEntries.createdAt));
    return rows.map(toEntry);
  },

  // Entries of the given users as `viewerId` may see them: other members' hidden entries are left out here.
  listForUsers: async (userIds: string[], viewerId: string, conn: Db = db) => {
    const rows = await conn
      .select({ ...columns, userId: ledgerEntries.userId })
      .from(ledgerEntries)
      .where(
        and(
          inArray(ledgerEntries.userId, userIds),
          isNull(ledgerEntries.deletedAt),
          or(eq(ledgerEntries.hidden, false), eq(ledgerEntries.userId, viewerId)),
        ),
      )
      .orderBy(asc(ledgerEntries.createdAt));
    return rows.map(toEntry);
  },

  findOwned: async (id: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .select(columns)
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.id, id), live(userId)));
    return row && toEntry(row);
  },

  insert: async (userId: string, entry: LedgerEntryInput, conn: Db = db) => {
    const [row] = await conn
      .insert(ledgerEntries)
      .values({
        userId,
        kind: entry.kind,
        type: entry.type,
        name: entry.name,
        valuePaise: entry.valuePaise,
        asOf: entry.asOf,
        hidden: entry.hidden,
        emiPaise: entry.kind === 'liability' ? entry.emiPaise : undefined,
        interestRateBps: entry.kind === 'liability' ? entry.interestRateBps : undefined,
      })
      .returning(columns);
    if (!row) throw new Error('ledger insert returned nothing');
    return toEntry(row);
  },

  // Replaces every editable field; undefined when the entry is not the user's or is deleted.
  replace: async (id: string, userId: string, entry: LedgerEntryInput, conn: Db = db) => {
    const [row] = await conn
      .update(ledgerEntries)
      .set({
        type: entry.type,
        name: entry.name,
        valuePaise: entry.valuePaise,
        asOf: entry.asOf,
        hidden: entry.hidden,
        emiPaise: entry.kind === 'liability' ? (entry.emiPaise ?? null) : null,
        interestRateBps: entry.kind === 'liability' ? (entry.interestRateBps ?? null) : null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(ledgerEntries.id, id), live(userId)))
      .returning(columns);
    return row && toEntry(row);
  },

  softDelete: async (id: string, userId: string, conn: Db = db) => {
    const [row] = await conn
      .update(ledgerEntries)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(ledgerEntries.id, id), live(userId)))
      .returning({ id: ledgerEntries.id });
    return row;
  },
};
