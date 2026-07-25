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

/**
 * db.select() for handlers that run several *different* selects in sequence
 * (an existence pre-check, then the real read). The Nth select() — 0-indexed —
 * resolves to `rowsByCall(n)`.
 */
export function sequentialSelect(rowsByCall: (call: number) => unknown[]): () => any {
  let call = 0;
  return () => chainSelect(rowsByCall(call++));
}

/**
 * Rows a `.returning()` resolves to, computed from everything the builder has
 * recorded so far. Throw from here to simulate a failing write.
 */
export type Returning = (recorded: unknown[]) => unknown[];

export interface Recorder {
  builder: any;
  recorded: unknown[];
}

/**
 * A write builder that appends every `recordOn` call to `recorded` and returns
 * itself, so the handler's chain runs to completion. Builders are deliberately
 * not thenable: routes that `await tx.insert(x).values(...)` without
 * `.returning()` get the plain object back, exactly as before.
 */
function recordingBuilder(recordOn: 'values' | 'set' | 'where', returning?: Returning): Recorder {
  const recorded: unknown[] = [];
  const builder: any = {
    where: () => builder,
    returning: async () => (returning ? returning(recorded) : []),
  };
  builder[recordOn] = (v: unknown) => {
    recorded.push(v);
    return builder;
  };
  return { builder, recorded };
}

/** insert().values(v) — records each `v`. */
export const recordingInsert = (returning?: Returning): Recorder =>
  recordingBuilder('values', returning);

/** update().set(v).where(...) — records each `v`. */
export const recordingUpdate = (returning?: Returning): Recorder =>
  recordingBuilder('set', returning);

/** delete().where(w) — records each `w`. */
export const recordingDelete = (returning?: Returning): Recorder =>
  recordingBuilder('where', returning);

/**
 * `.returning()` rows for the common case: the fixture row with the write that
 * was just made merged over it. Uses the latest recorded write, so a handler
 * that writes twice through one mock reads back the second write.
 */
export const mergedRow =
  (fixture: object): Returning =>
  (recorded) => [{ ...fixture, ...(recorded[recorded.length - 1] as object) }];

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
}

/**
 * A db whose insert/update/delete record what the handler wrote, and whose
 * transaction runs the callback against those same builders — so a route that
 * writes inside tx and one that writes directly are asserted the same way.
 */
export function makeDbMock(opts: DbMockOptions = {}): DbMock {
  const insert = recordingInsert(opts.insertRows);
  const update = recordingUpdate(opts.updateRows);
  const remove = recordingDelete(opts.deleteRows);
  const emptySelect = () => chainSelect([]);

  const tx = {
    insert: () => insert.builder,
    update: () => update.builder,
    delete: () => remove.builder,
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
  };
}
