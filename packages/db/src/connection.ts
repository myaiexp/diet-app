// Postgres pool + drizzle instance factory (the app's only DB entry point)

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

/**
 * Bounds every pooled connection. Without these a pool has no timeout at all:
 * `pool.connect()` waits forever when Postgres is unreachable or the pool is
 * saturated, and a wedged backend pins a connection slot (and, in the cook
 * flow, its FOR UPDATE locks) indefinitely.
 *
 * - `connectionTimeoutMillis` — cap the wait for a free/new client.
 * - `idleTimeoutMillis` — retire idle clients so a restarted Postgres doesn't
 *   leave the pool full of dead sockets.
 * - `statement_timeout` — server-side cancel, the authoritative bound.
 * - `query_timeout` — client-side backstop, deliberately *above*
 *   statement_timeout: the server's own cancel is cleaner (it releases locks),
 *   so this only fires when the connection itself has gone silent and the
 *   server-side timer can never report back.
 * - `idle_in_transaction_session_timeout` — a transaction that stalls between
 *   statements (a crashed client mid-cook) is aborted instead of holding row
 *   locks forever. Every statement here is in-process compute apart, so this
 *   can only trip on a genuine stall.
 */
export const POOL_DEFAULTS = {
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  idle_in_transaction_session_timeout: 15_000,
} as const;

/** Per-call overrides for the bounds above (e.g. a long-running seed/migration). */
export type PoolOverrides = Partial<Record<keyof typeof POOL_DEFAULTS, number>>;

/**
 * A bounded pool that survives losing its backend.
 *
 * node-postgres emits `'error'` on the Pool when an *idle* client's connection
 * dies — a Postgres restart, `pg_terminate_backend`, a dropped SSH tunnel. Node
 * treats an EventEmitter `'error'` with no listener as a throw, so without this
 * handler a routine `systemctl restart postgresql` takes the API process down
 * with it. Logging it lets the pool discard the dead client and reconnect on
 * the next query.
 */
export function createPool(connectionString: string, overrides: PoolOverrides = {}): pg.Pool {
  const pool = new pg.Pool({ connectionString, ...POOL_DEFAULTS, ...overrides });
  pool.on('error', (err) => {
    console.error('[db] idle client error (pool will reconnect):', err);
  });
  return pool;
}

export function createDb(connectionString: string, overrides: PoolOverrides = {}) {
  return drizzle(createPool(connectionString, overrides), { schema });
}

export type Db = ReturnType<typeof createDb>;
