import { customType } from 'drizzle-orm/pg-core';

// drizzle-orm 0.45 has no bytea column, and drizzle-kit pull can't introspect one.
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});
