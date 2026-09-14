// Real db wrapper that fails one table's writes, to prove a route rolls back
import { afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '@diet-app/db';

export type WriteOp = 'insert' | 'update' | 'delete';

export class InjectedFault extends Error {
  constructor(label: string) {
    super(`injected fault: ${label}`);
    this.name = 'InjectedFault';
  }
}

export interface FaultDb {
  /** Pass to createApp in place of the real db. */
  db: Db;
  /** Every write the route started through this db, as `op:table`, in order — the faulting one included. */
  readonly issued: string[];
  /** How many times the fault fired; 0 means the route never reached the write. */
  readonly fired: number;
}

/**
 * Wrap a real db so every `op` on `table` throws, on the db itself and inside
 * any transaction it opens; every other statement runs against Postgres for
 * real. The writes a route issued before the faulting one have already been
 * executed by then, so whatever survives afterwards is exactly what the route
 * failed to roll back. The fault fires on the db too, not only on `tx`, so a
 * route stripped of its transaction still fails at the same statement and a
 * test reads the leftover writes rather than an unexpected 200.
 *
 * This is the counterpart of db-mock.ts, whose transaction cannot roll back.
 */
export function withWriteFault(db: Db, op: WriteOp, table: PgTable): FaultDb {
  const issued: string[] = [];
  let fired = 0;

  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop) {
        const value: unknown = Reflect.get(obj, prop, obj);
        if (typeof value !== 'function') return value;
        if (prop === 'insert' || prop === 'update' || prop === 'delete') {
          return (t: PgTable) => {
            const label = `${prop}:${getTableName(t)}`;
            issued.push(label);
            if (prop === op && t === table) {
              fired += 1;
              throw new InjectedFault(label);
            }
            return value.call(obj, t);
          };
        }
        if (prop === 'transaction') {
          return (fn: (tx: object) => unknown, ...rest: unknown[]) =>
            value.call(obj, (tx: object) => fn(wrap(tx)), ...rest);
        }
        return value.bind(obj);
      },
    });

  return {
    db: wrap(db),
    get issued() {
      return issued;
    },
    get fired() {
      return fired;
    },
  };
}

/**
 * Hono's default error handler console.errors every uncaught error before its
 * 500. Drop only the injected ones, so a real failure still prints.
 */
export function silenceInjectedFaults(): void {
  let spy: MockInstance<typeof console.error> | undefined;
  beforeEach(() => {
    const original = console.error.bind(console);
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (args.some((a) => a instanceof InjectedFault)) return;
      original(...args);
    });
  });
  afterEach(() => spy?.mockRestore());
}
