import { asc, eq, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { families, killSwitches } from '#database/schema';
import { switchColumns, toKillSwitch } from './admin.query';

export const AdminRepository = {
  listKillSwitches: async (conn: Db = db) => {
    const rows = await conn
      .select(switchColumns)
      .from(killSwitches)
      .orderBy(asc(killSwitches.scope), asc(killSwitches.scopeKey));
    return rows.map(toKillSwitch);
  },

  upsertKillSwitch: async (
    values: { scope: string; scopeKey: string; engaged: boolean; reason: string; changedBy: string },
    conn: Db = db,
  ) => {
    const [row] = await conn
      .insert(killSwitches)
      .values(values)
      .onConflictDoUpdate({
        target: [killSwitches.scope, killSwitches.scopeKey],
        set: {
          engaged: values.engaged,
          reason: values.reason,
          changedBy: values.changedBy,
          changedAt: sql`now()`,
        },
      })
      .returning(switchColumns);
    if (!row) throw new Error('kill switch upsert returned nothing');
    return toKillSwitch(row);
  },

  familyExists: async (id: string, conn: Db = db) => {
    const [row] = await conn.select({ id: families.id }).from(families).where(eq(families.id, id));
    return row !== undefined;
  },
};
