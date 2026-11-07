import { asc, inArray, like } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { instruments } from '#database/schema';
import { escapeLike, instrumentColumns } from './instrument.query';

export const InstrumentRepository = {
  searchBySymbolPrefix: (q: string, conn: Db = db) =>
    conn
      .select(instrumentColumns)
      .from(instruments)
      .where(like(instruments.tradingSymbol, `${escapeLike(q.toUpperCase())}%`))
      .orderBy(asc(instruments.tradingSymbol))
      .limit(20),

  findByIds: (ids: string[], conn: Db = db) =>
    conn.select(instrumentColumns).from(instruments).where(inArray(instruments.id, ids)),
};
