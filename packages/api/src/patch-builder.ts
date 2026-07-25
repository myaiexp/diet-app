// Builds Drizzle update payloads from Zod-parsed PATCH bodies

import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/** Patch fields that name a real column of the target table. */
type ColumnKeys<T, TTable extends PgTable> = keyof T & keyof TTable['$inferInsert'];

/**
 * Copies every defined field of `data` that is also a column of `table`.
 *
 * The column set comes from the table rather than a hand-kept list, so adding a
 * field to a Zod patch schema writes it automatically instead of silently
 * dropping it when someone forgets the matching `if (x !== undefined)` line.
 * Patch fields that are not columns (child-table writes like `ingredients` or
 * `dislikedIngredientIds`) are skipped and stay the route's job.
 *
 * `omit` is for columns the route must write itself — numeric columns whose Zod
 * type is `number` need `String(...)`, and passing the raw number through would
 * be a type error at the call site anyway.
 */
export function buildPatch<
  T extends object,
  TTable extends PgTable,
  O extends ColumnKeys<T, TTable> = never,
>(
  data: T,
  table: TTable,
  omit: readonly O[] = [],
): Omit<Partial<Pick<T, ColumnKeys<T, TTable>>>, O> {
  const skip = new Set<string>(omit as readonly string[]);
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(getTableColumns(table))) {
    if (skip.has(key)) continue;
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }

  return out as Omit<Partial<Pick<T, ColumnKeys<T, TTable>>>, O>;
}
