// Pulls the Drizzle schema from the migrated database into src/database/schema/, one file per
// migration (accounts, families, ...). Tables keep their columns and primary keys only: Postgres
// enforces the checks, foreign keys and indexes, and relations.ts carries the joins.
import { rm } from 'node:fs/promises';
import { $ } from 'bun';

const api = `${import.meta.dir}/..`;
const dir = `${api}/src/database`;
const migrations = `${api}/../../db/migrations`;

await $`drizzle-kit pull`.cwd(api);
await rm(`${dir}/meta`, { recursive: true, force: true });
for await (const file of new Bun.Glob('*.sql').scan(dir)) await rm(`${dir}/${file}`);

// A table lives in the file named after the migration that creates it: 00003_accounts.sql -> accounts.schema.ts.
const fileOfTable = new Map<string, string>();
const tableOrder: string[] = [];
for await (const migration of new Bun.Glob('*.sql').scan(migrations)) {
  const name = migration.replace(/^\d+_/, '').replace(/\.sql$/, '');
  const text = await Bun.file(`${migrations}/${migration}`).text();
  for (const [, table = ''] of text.matchAll(/CREATE TABLE (\w+)/g)) {
    fileOfTable.set(table, name);
    tableOrder.push(table);
  }
}

// drizzle-kit 0.31 can't read bytea, writes '{}' as [''], and its identity options and bigint hints are noise.
const pulled = (await Bun.file(`${dir}/schema.ts`).text())
  .replaceAll(/^\s*\/\/ TODO: failed to parse database type 'bytea'\n/gm, '')
  .replaceAll(/^\s*\/\/ You can use \{ mode: "bigint" \}.*\n/gm, '')
  .replaceAll('unknown(', 'bytea(')
  .replaceAll('.default([""])', '.default([])')
  .replaceAll(/generatedAlwaysAsIdentity\(\{[^}]*\}\)/g, 'generatedAlwaysAsIdentity()');

const pgCoreNames = pulled.match(/import \{ (.+) \} from "drizzle-orm\/pg-core"/)?.[1]?.split(', ') ?? [];

function keepColumnsAndPrimaryKey(table: string) {
  const [columns, extras] = table.split('\n}, (table) => [\n');
  if (extras === undefined) return table;
  const primaryKey = extras.split('\n').filter((line) => line.trim().startsWith('primaryKey('));
  return primaryKey.length ? `${columns}\n}, (table) => [\n${primaryKey.join('\n')}\n]);` : `${columns}\n});`;
}

function imports(body: string) {
  // Lookbehind skips methods: .primaryKey() is a column method, primaryKey() an import.
  const used = pgCoreNames.filter((name) => new RegExp(`(?<![.\\w])${name}\\(`).test(body));
  const lines = [`import { ${used.join(', ')} } from 'drizzle-orm/pg-core';`];
  if (body.includes('sql`')) lines.unshift(`import { sql } from 'drizzle-orm';`);
  if (body.includes('bytea(')) lines.push(`import { bytea } from '#database/bytea';`);
  return lines.join('\n');
}

const blocks = pulled
  .split('\n\n')
  .map((block) => ({ block, table: block.match(/^export const \w+ = pgTable\("(\w+)"/)?.[1] ?? '' }))
  .filter(({ table }) => table)
  .sort((a, b) => tableOrder.indexOf(a.table) - tableOrder.indexOf(b.table));

const tablesByFile = new Map<string, string[]>();
for (const { block, table } of blocks) {
  const file = fileOfTable.get(table);
  if (!file) throw new Error(`No migration in db/migrations creates table ${table}`);
  tablesByFile.set(file, [...(tablesByFile.get(file) ?? []), keepColumnsAndPrimaryKey(block)]);
}

await rm(`${dir}/schema.ts`);
await rm(`${dir}/schema`, { recursive: true, force: true });
for (const [file, tables] of tablesByFile) {
  const body = tables.join('\n\n');
  await Bun.write(`${dir}/schema/${file}.schema.ts`, `${imports(body)}\n\n${body}\n`);
}
const index = [...tablesByFile.keys()].sort().map((file) => `export * from './${file}.schema';`);
await Bun.write(`${dir}/schema/index.ts`, `${index.join('\n')}\n`);

await $`biome check --write ${dir}`;
