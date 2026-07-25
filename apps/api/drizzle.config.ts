import { defineConfig } from 'drizzle-kit';

// Read-only: the schema comes from db/migrations, and this only pulls it into TS.
export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  out: './src/database',
  schemaFilter: ['public'],
  tablesFilter: ['!goose_db_version'],
  introspect: { casing: 'camel' },
});
