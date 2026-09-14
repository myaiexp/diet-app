// ON CONFLICT DO UPDATE helper shared by the ingredient seed and product import

import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

// Build an `ON CONFLICT DO UPDATE SET` that copies each given column from the
// proposed row (excluded.*). Column SQL names are read from the schema so a
// rename can't silently desync the update list.
export function excludedColumns<T extends Record<string, PgColumn>>(cols: T): Record<keyof T, SQL> {
  return Object.fromEntries(
    Object.entries(cols).map(([key, col]) => [key, sql.raw(`excluded.${col.name}`)]),
  ) as Record<keyof T, SQL>;
}
