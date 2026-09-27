// Builds Drizzle update payloads from Zod-parsed PATCH bodies

import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/** Patch fields that name a real column of the target table. */
type ColumnKeys<T, TTable extends PgTable> = keyof T & keyof TTable['$inferInsert'];

type Columns<TTable extends PgTable> = TTable['_']['columns'];

/** Columns declared with `numeric(...)` — Drizzle reads and writes them as strings. */
type NumericKeys<TTable extends PgTable> = {
  [K in keyof Columns<TTable>]: Columns<TTable>[K]['_']['columnType'] extends 'PgNumeric' ? K : never;
}[keyof Columns<TTable>];

/** Distributes over the field's union, so `number | null` becomes `string | null`. */
type NumberToString<V> = V extends number ? string : V;

type Patch<T, TTable extends PgTable, O extends PropertyKey> = {
  [K in Exclude<ColumnKeys<T, TTable>, O>]?: K extends NumericKeys<TTable>
    ? NumberToString<T[K]>
    : T[K];
};

/**
 * Copies every defined field of `data` that is also a column of `table`.
 *
 * The column set comes from the table rather than a hand-kept list, so adding a
 * field to a Zod patch schema writes it automatically instead of silently
 * dropping it when someone forgets the matching `if (x !== undefined)` line.
 * Patch fields that are not columns (child-table writes like `ingredients` or
 * `dislikedIngredientIds`) are skipped and stay the route's job.
 *
 * The same table read decides the value form: a number bound for a Postgres
 * `numeric` column goes through `String()`, because Drizzle types those columns
 * as strings (arbitrary precision). Zod parses them as numbers, so without this
 * every route would omit the column and restringify it by hand.
 *
 * `omit` is for columns the route must write itself — values it derives or
 * merges rather than copies (e.g. the cook-feedback note pair).
 */
export function buildPatch<
  T extends object,
  TTable extends PgTable,
  O extends ColumnKeys<T, TTable> = never,
>(data: T, table: TTable, omit: readonly O[] = []): Patch<T, TTable, O> {
  const skip = new Set<string>(omit as readonly string[]);
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (skip.has(key)) continue;
    const value = source[key];
    if (value === undefined) continue;
    out[key] =
      typeof value === 'number' && column.columnType === 'PgNumeric' ? String(value) : value;
  }

  return out as Patch<T, TTable, O>;
}
