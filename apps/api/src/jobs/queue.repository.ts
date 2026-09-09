import { type Db, db } from '#config/database.config';
import { jobs } from '#database/schema';

export const JOB = {
  holdingsSync: 'holdings_sync',
  executeBasket: 'execute_basket',
  cancelBasket: 'cancel_basket',
} as const;

type NewJob = { kind: string; payload: Record<string, unknown>; lane?: string; dedupeKey?: string };

export const JobsRepository = {
  // A job whose dedupe key is already queued is ignored.
  enqueue: async (job: NewJob, conn: Db = db) => {
    await conn.insert(jobs).values(job).onConflictDoNothing({ target: jobs.dedupeKey });
  },
};
