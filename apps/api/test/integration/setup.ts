// Preloaded by `bun test`: points the API at bargad_test, migrates it, and empties it before each test.
import { beforeEach } from 'bun:test';
import { $, SQL } from 'bun';
import './engine';

const url = new URL(process.env.DATABASE_URL ?? '');
const admin = new SQL(url.href);
const [exists] = await admin`select 1 from pg_database where datname = 'bargad_test'`;
if (!exists) await admin.unsafe('create database bargad_test');
await admin.close();

url.pathname = '/bargad_test';
process.env.DATABASE_URL = url.href;

// go run goose costs seconds, so only call it when a migration is pending.
const root = `${import.meta.dir}/../../../..`;
const latest = Math.max(
  ...[...new Bun.Glob('*.sql').scanSync(`${root}/db/migrations`)].map((f) => Number.parseInt(f, 10)),
);
const testDb = new SQL(url.href);
const [applied] = await testDb`
  select max(version_id) as v from goose_db_version where is_applied`.catch(() => [{ v: 0 }]);
await testDb.close();
if (Number(applied?.v ?? 0) < latest) {
  await $`bun run goose up`.cwd(root).env(process.env).quiet();
}

const { db } = await import('#config/database.config');
const { sql } = await import('drizzle-orm');
const { resetRateLimits } = await import('#middlewares/ratelimit.middleware');
const { captureMail } = await import('./fixtures');

beforeEach(async () => {
  resetRateLimits();
  captureMail();
  await db.transaction(async (tx) => {
    // Replica mode skips triggers, including audit_log's no-truncate guard.
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`
      do $$ begin
        execute (select 'truncate ' || string_agg(quote_ident(tablename), ', ') || ' cascade'
                 from pg_tables where schemaname = 'public' and tablename <> 'goose_db_version');
      end $$`);
  });
});
