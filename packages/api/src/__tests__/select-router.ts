// Table-keyed select() dispatch for route test suites.
//
// A route runs several selects per request. Keying fixtures on invocation order
// — `call === 0 ? entry : lines` — couples the suite to the statement order
// inside the handler: reorder two independent selects and the mock hands back
// the wrong rows, so a test passes or fails for reasons unrelated to the
// change. Nothing about those queries is actually ambiguous, though. Every
// select names its table in .from(), and its WHERE clause carries the id it
// asked for, so a fixture can be chosen by what was queried instead of by when.
//
// Register one fixture per table the handler reads. An unregistered read throws
// naming the table, so a select added to a route surfaces as a named failure
// instead of a silent empty result; pass `fallback` for suites that genuinely
// don't care about the rest.

import { type Table } from 'drizzle-orm';
import { tableNameOf, whereParams } from './drizzle-introspect.js';

/** One select the handler ran, as observed by the router. */
export interface SelectRead {
  /** Table named in .from(), e.g. 'pantry_items'. */
  table: string;
  /** True when the handler locked the rows with .for('update'). */
  forUpdate: boolean;
  /** Bound predicate params — e.g. the id passed to eq(table.id, id). */
  params: unknown[];
  where?: unknown;
  limit?: number;
  /** Columns passed to .orderBy(), so a cook/list test can pin the sort. */
  orderBy?: unknown[];
}

/** Rows a table's select resolves to; a function to key on the id queried. */
export type SelectFixture = unknown[] | ((read: SelectRead) => unknown[]);

export interface SelectRouter {
  /** Pass as `select` / `txSelect` to makeDbMock. */
  select: () => any;
  /** Every select the handler ran, in order — assert which table was locked. */
  reads: SelectRead[];
}

export function makeSelectRouter(
  routes: Array<[Table, SelectFixture]>,
  opts: { fallback?: SelectFixture } = {},
): SelectRouter {
  const byTable = new Map<string, SelectFixture>();
  for (const [table, fixture] of routes) byTable.set(tableNameOf(table), fixture);
  const reads: SelectRead[] = [];

  const rowsFor = (read: SelectRead): unknown[] => {
    const fixture = byTable.get(read.table) ?? opts.fallback;
    if (fixture === undefined) {
      const known = [...byTable.keys()].join(', ') || 'none';
      throw new Error(
        `select-router: no fixture registered for table '${read.table}' (registered: ${known})`,
      );
    }
    return typeof fixture === 'function' ? fixture(read) : fixture;
  };

  const select = (): any => {
    // Fresh per select() so concurrent chains can't share captured state.
    const read: SelectRead = { table: 'unknown', forUpdate: false, params: [] };
    const builder: any = {
      from: (t: unknown) => {
        read.table = tableNameOf(t);
        return builder;
      },
      where: (w: unknown) => {
        read.where = w;
        read.params = whereParams(w);
        return builder;
      },
      limit: (n: number) => {
        read.limit = n;
        return builder;
      },
      offset: () => builder,
      orderBy: (...cols: unknown[]) => {
        read.orderBy = cols;
        return builder;
      },
      for: () => {
        read.forUpdate = true;
        return builder;
      },
      // Thenable: `await builder` at any chain depth resolves the fixture.
      then: (resolve: (v: unknown[]) => unknown) => {
        reads.push(read);
        return resolve(rowsFor(read));
      },
    };
    return builder;
  };

  return { select, reads };
}
