// Chainable mock for Drizzle's core select() builder used by list endpoints.
// Records the where/limit/offset args and resolves, when awaited at any point in
// the chain, to `rows` — so handlers using
// db.select().from(t).where(...).limit(n).offset(k) work without a real Postgres.

export interface SelectMock {
  db: any;
  calls: { where?: unknown; limit?: number; offset?: number };
}

export function makeSelectMock(rows: unknown[]): SelectMock {
  const calls: SelectMock['calls'] = {};
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
    // Thenable: `await builder` (at any chain depth) resolves to rows.
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  return { db: { select: () => builder }, calls };
}
