import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as relations from '#database/relations';
import * as schema from '#database/schema';
import { env } from './env.config';

export const db = drizzle({
  client: new SQL(env.DATABASE_URL),
  schema: { ...schema, ...relations },
});

// The tx that db.transaction hands to its callback.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Repositories take this as their last argument, so a service can pass its transaction.
export type Db = typeof db | Tx;

// Services open transactions through this, so they never import db.
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>) {
  return db.transaction(fn);
}
