// Chainable Drizzle builder mocks shared by the route test suites.
//
// Route handlers build queries as chains — db.select().from().where().limit(),
// db.insert().values().returning(), db.update().set().where().returning(),
// db.delete().where() — so a fake db has to return objects that keep returning
// themselves and resolve at the end. These factories record what the handler
// passed (the assertion surface: which values were inserted, which patch was
// set) and resolve to caller-supplied fixture rows, letting the suites run
// without a real Postgres.
//
// Suites compose these with their own `db.query.X.findFirst` stubs rather than
// configuring one mega-mock: the chain shape is what every suite shares, the
// fixtures and relational stubs are what makes each suite different.
//
// Reads are dispatched by table in select-router.ts; writes record the table
// they targeted here, so neither side has to key on statement order.

import { tableNameOf } from './drizzle-introspect.js';

export interface SelectMock {
  db: any;
  calls: { where?: unknown; limit?: number; offset?: number };
}

/**
 * One chainable select() builder. from/where/limit/offset/for return the
 * builder, and awaiting it at any chain depth resolves to `rows`. Pass `calls`
 * to record the args the handler applied.
 */
export function chainSelect(rows: unknown[], calls: SelectMock['calls'] = {}): any {
  const builder: any = {
    from: () => builder,
    where: (w: unknown) => {
      calls.where = w;
      return builder;
    },
    limit: (n: number) => {
      calls.limit = n;
      return builder;
    },
    offset: (k: number) => {
      calls.offset = k;
      return builder;
    },
    // .for('update') row lock — the value is irrelevant to a mock.
    for: () => builder,
    // Thenable: `await builder` (at any chain depth) resolves to rows.
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  return builder;
}

/** db.select() for list endpoints: a single chain resolving to `rows`. */
export function makeSelectMock(rows: unknown[]): SelectMock {
  const calls: SelectMock['calls'] = {};
  return { db: { select: () => chainSelect(rows, calls) }, calls };
}

/** One insert/update/delete statement the handler ran, with its table. */
export interface WriteRecord {
  kind: 'insert' | 'update' | 'delete';
  /** Table named in insert()/update()/delete(), e.g. 'pantry_items'. */
  table: string;
  /** insert().values(v) or update().set(v); undefined for a delete. */
  values?: unknown;
  /** The .where() clause, when the handler applied one. */
  where?: unknown;
}

/**
 * Rows a `.returning()` resolves to. Receives everything recorded through this
 * builder so far, plus the record for *this* statement — key on `record.table`
 * or `record.values` when a handler writes to several tables through the same
 * builder, so the fixture doesn't depend on which write happened to be last.
 * Throw from here to simulate a failing write.
 */
export type Returning = (recorded: unknown[], record: WriteRecord) => unknown[];

interface Recorder {
  /** One builder per insert(t)/update(t)/delete(t) call. */
  make: (table?: unknown) => any;
  recorded: unknown[];
}

/**
 * A write builder that appends every `recordOn` call to `recorded` and returns
 * itself, so the handler's chain runs to completion. A fresh builder per
 * statement keeps the table and WHERE of one write from leaking into the next.
 * Builders are deliberately not thenable: routes that
 * `await tx.insert(x).values(...)` without `.returning()` get the plain object
 * back, exactly as before.
 */
function makeRecorder(
  kind: WriteRecord['kind'],
  recordOn: 'values' | 'set' | 'where',
  writes: WriteRecord[],
  returning?: Returning,
): Recorder {
  const recorded: unknown[] = [];

  const make = (table?: unknown): any => {
    const record: WriteRecord = { kind, table: tableNameOf(table) };
    let logged = false;
    // .set() then .where() both fire on one statement — log it once.
    const log = () => {
      if (logged) return;
      writes.push(record);
      logged = true;
    };

    const builder: any = {
      where: (w: unknown) => {
        record.where = w;
        if (recordOn === 'where') recorded.push(w);
        log();
        return builder;
      },
      returning: async () => (returning ? returning(recorded, record) : []),
    };
    if (recordOn !== 'where') {
      builder[recordOn] = (v: unknown) => {
        recorded.push(v);
        record.values = v;
        log();
        return builder;
      };
    }
    return builder;
  };

  return { make, recorded };
}

/**
 * `.returning()` rows for the common case: the fixture row with the write this
 * returning belongs to merged over it.
 */
export const mergedRow =
  (fixture: object): Returning =>
  (_recorded, record) => [{ ...fixture, ...(record.values as object) }];

export interface DbMockOptions {
  /** Rows POST/PATCH read back from insert().returning(). */
  insertRows?: Returning;
  /** Rows PATCH reads back from update().returning(). */
  updateRows?: Returning;
  /** Rows DELETE reads back from delete().returning(). */
  deleteRows?: Returning;
  /** Relational stubs: `{ pantryItems: { findFirst: vi.fn(...) } }`. */
  query?: Record<string, unknown>;
  /** db.select() — defaults to an empty result. */
  select?: () => any;
  /** tx.select() when the transaction reads differently (e.g. a FOR UPDATE lock). */
  txSelect?: () => any;
  /** Runs before the transaction callback — throw here to simulate a DB error. */
  beforeTransaction?: () => void;
}

export interface DbMock {
  db: any;
  /** Values passed to insert().values(), in call order. */
  inserts: unknown[];
  /** Patches passed to update().set(), in call order. */
  updates: unknown[];
  /** Conditions passed to delete().where(), in call order. */
  deletes: unknown[];
  /**
   * Every write with the table it targeted — filter by table when a handler
   * writes to several (`writes.filter((w) => w.table === 'pantry_items')`).
   */
  writes: WriteRecord[];
}

/**
 * A db whose insert/update/delete record what the handler wrote, and whose
 * transaction runs the callback against those same builders — so a route that
 * writes inside tx and one that writes directly are asserted the same way.
 */
export function makeDbMock(opts: DbMockOptions = {}): DbMock {
  const writes: WriteRecord[] = [];
  const insert = makeRecorder('insert', 'values', writes, opts.insertRows);
  const update = makeRecorder('update', 'set', writes, opts.updateRows);
  const remove = makeRecorder('delete', 'where', writes, opts.deleteRows);
  const emptySelect = () => chainSelect([]);

  const tx = {
    insert: (t?: unknown) => insert.make(t),
    update: (t?: unknown) => update.make(t),
    delete: (t?: unknown) => remove.make(t),
    select: opts.txSelect ?? opts.select ?? emptySelect,
  };

  const db = {
    ...tx,
    select: opts.select ?? emptySelect,
    query: opts.query ?? {},
    transaction: async (fn: (t: typeof tx) => unknown) => {
      opts.beforeTransaction?.();
      return fn(tx);
    },
  } as any;

  return {
    db,
    inserts: insert.recorded,
    updates: update.recorded,
    deletes: remove.recorded,
    writes,
  };
}
