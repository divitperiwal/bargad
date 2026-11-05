import { and, asc, desc, eq, gte, or, sql } from 'drizzle-orm';
import { type Db, db } from '#config/database.config';
import { basketItems, baskets, instruments, orders, tradingHolidays } from '#database/schema';
import { toIso } from '#utils/time/time.util';
import {
  type BasketCursor,
  basketColumns,
  creatorStillHeads,
  headSeesBasket,
  type NewBasket,
  type NewBasketItem,
  ownerMayTrade,
  toBasket,
} from './basket.query';

export const BasketRepository = {
  // Holidays from today (IST) on; earlier ones cannot change the next trading day.
  upcomingNseHolidays: async (conn: Db = db) => {
    const rows = await conn
      .select({ day: tradingHolidays.day })
      .from(tradingHolidays)
      .where(
        and(
          eq(tradingHolidays.exchange, 'NSE'),
          gte(tradingHolidays.day, sql`(now() at time zone 'Asia/Kolkata')::date`),
        ),
      );
    return new Set(rows.map((row) => row.day));
  },

  insert: async (values: NewBasket, items: NewBasketItem[], conn: Db = db) => {
    const [row] = await conn.insert(baskets).values(values).returning(basketColumns);
    if (!row) throw new Error('basket insert returned nothing');
    await conn
      .insert(basketItems)
      .values(items.map((item) => ({ ...item, basketId: row.id, ownerUserId: row.ownerUserId })));
    return toBasket(row);
  },

  findById: async (id: string, conn: Db = db) => {
    const [row] = await conn.select(basketColumns).from(baskets).where(eq(baskets.id, id));
    return row && toBasket(row);
  },

  isSeenByHead: async (id: string, viewerId: string, conn: Db = db) => {
    const [row] = await conn
      .select({ id: baskets.id })
      .from(baskets)
      .where(and(eq(baskets.id, id), headSeesBasket(viewerId)));
    return row !== undefined;
  },

  // Keyset page ordered by (created_at, id) descending; `cursorAt` is created_at as raw Postgres text.
  // A creator's page applies the read rule: own baskets, or ones whose owner is still in the family they head.
  findPage: async (
    viewerId: string,
    query: { role: 'owner' | 'creator'; status?: string; limit: number },
    after: BasketCursor | undefined,
    conn: Db = db,
  ) => {
    const rows = await conn
      .select({ ...basketColumns, cursorAt: sql<string>`${baskets.createdAt}::text` })
      .from(baskets)
      .where(
        and(
          query.role === 'owner'
            ? eq(baskets.ownerUserId, viewerId)
            : and(eq(baskets.createdBy, viewerId), or(eq(baskets.ownerUserId, viewerId), headSeesBasket(viewerId))),
          query.status ? eq(baskets.status, query.status) : undefined,
          after
            ? sql`(${baskets.createdAt}, ${baskets.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(baskets.createdAt), desc(baskets.id))
      .limit(query.limit + 1);
    return rows.map(({ cursorAt, ...row }) => ({ ...toBasket(row), cursorAt }));
  },

  listOrders: async (basketId: string, conn: Db = db) => {
    const rows = await conn
      .select({
        id: orders.id,
        basketItemId: orders.basketItemId,
        status: orders.status,
        limitPricePaise: orders.limitPricePaise,
        filledQty: orders.filledQty,
        avgFillPaise: orders.avgFillPaise,
        rejectReason: orders.rejectReason,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(basketItems, eq(basketItems.id, orders.basketItemId))
      .where(eq(basketItems.basketId, basketId))
      .orderBy(asc(orders.createdAt), asc(orders.id));
    return rows.map((row) => ({ ...row, updatedAt: toIso(row.updatedAt) }));
  },

  // Undefined unless the basket was in `from`, so two simultaneous transitions cannot both win.
  transition: async (id: string, from: string, to: string, conn: Db = db) => {
    const [row] = await conn
      .update(baskets)
      .set({ status: to, updatedAt: sql`now()` })
      .where(and(eq(baskets.id, id), eq(baskets.status, from)))
      .returning(basketColumns);
    return row && toBasket(row);
  },

  // Re-checks the family in the same statement, so a leave, a view-only relationship or a handover
  // committed after the service's check still stops the approval. Undefined when nothing was approved.
  markApproved: async (id: string, passkeyId: string, expiresAt: Date, conn: Db = db) => {
    const [row] = await conn
      .update(baskets)
      .set({
        status: 'queued',
        approvedAt: sql`now()`,
        approvalExpiresAt: expiresAt.toISOString(),
        approvedPasskeyId: passkeyId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(baskets.id, id),
          eq(baskets.status, 'proposed'),
          eq(baskets.mode, 'approval'),
          ownerMayTrade,
          creatorStillHeads,
        ),
      )
      .returning(basketColumns);
    return row && toBasket(row);
  },

  setRefPrice: async (basketId: string, itemId: string, refPricePaise: number, conn: Db = db) => {
    await conn
      .update(basketItems)
      .set({ refPricePaise })
      .where(and(eq(basketItems.id, itemId), eq(basketItems.basketId, basketId)));
  },

  listItems: (basketId: string, conn: Db = db) =>
    conn
      .select({
        id: basketItems.id,
        brokerAccountId: basketItems.brokerAccountId,
        instrumentId: basketItems.instrumentId,
        tradingSymbol: instruments.tradingSymbol,
        side: basketItems.side,
        quantity: basketItems.quantity,
        refPricePaise: basketItems.refPricePaise,
      })
      .from(basketItems)
      .innerJoin(instruments, eq(instruments.id, basketItems.instrumentId))
      .where(eq(basketItems.basketId, basketId))
      .orderBy(asc(instruments.tradingSymbol), asc(basketItems.id)),
};
