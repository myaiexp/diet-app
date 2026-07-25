// Read table identity and bound params off Drizzle objects (test-side only).
//
// Route mocks need to answer "which table was this, and which id did it ask
// for?" without a real Postgres. Both are recoverable from the objects the
// handler already passes: the table it named in .from()/.update(), and the
// WHERE clause, which the dialect renders to SQL text plus bound params.

import { getTableName, type Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

/** Schema table name, e.g. 'meal_plan_entries'. 'unknown' for a non-table. */
export function tableNameOf(table: unknown): string {
  try {
    return getTableName(table as Table);
  } catch {
    return 'unknown';
  }
}

/**
 * Render a WHERE clause to SQL text plus bound params. Returns empty strings
 * rather than throwing for `undefined` (an unfiltered query) or a clause the
 * dialect can't render, so a mock can introspect unconditionally.
 */
export function renderWhere(where: unknown): { sql: string; params: unknown[] } {
  if (where === undefined) return { sql: '', params: [] };
  try {
    const { sql, params } = dialect.sqlToQuery(where as never);
    return { sql, params };
  } catch {
    return { sql: '', params: [] };
  }
}

/** Bound params of a WHERE clause — the ids/values the handler looked up. */
export const whereParams = (where: unknown): unknown[] => renderWhere(where).params;
