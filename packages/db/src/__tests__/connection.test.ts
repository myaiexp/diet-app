import { describe, test, expect, vi, afterEach } from 'vitest';
import { createDb, createPool, POOL_DEFAULTS } from '../connection.js';

const DUMMY = 'postgres://user:pass@127.0.0.1:5432/nonexistent';

describe('createDb', () => {
  test('returns a drizzle instance with the core query builder', () => {
    const db = createDb(DUMMY);
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
    expect(typeof db.update).toBe('function');
    expect(typeof db.delete).toBe('function');
  });

  test('exposes the relational query API for every schema table', () => {
    const db = createDb(DUMMY);
    expect(db.query).toBeDefined();
    const tables = [
      'ingredients',
      'recipes',
      'recipeIngredients',
      'pantryItems',
      'mealPlanEntries',
      'cookFeedback',
      'shoppingLists',
      'shoppingListItems',
      'userProfile',
      'userDislikedIngredients',
    ] as const;
    for (const t of tables) {
      expect(db.query[t], `db.query.${t} should be wired`).toBeDefined();
      expect(typeof db.query[t].findFirst).toBe('function');
      expect(typeof db.query[t].findMany).toBe('function');
    }
  });

  test('does not connect at construction time (no throw on a dead host)', () => {
    // An unreachable host must not surface until a query runs — construction is
    // pure wiring. If this ever throws, the pool is eagerly connecting.
    expect(() => createDb('postgres://user:pass@10.255.255.1:5432/db')).not.toThrow();
  });
});

// Finding #5461: a pool built from nothing but a connection string has no
// timeout anywhere and no 'error' listener, so an idle backend dying (Postgres
// restart, pg_terminate_backend, a dropped tunnel) takes the API process with
// it. These assert the bounds are actually handed to pg and that the listener
// exists — both invisible from the drizzle instance, hence createPool.
describe('createPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('applies every bound in POOL_DEFAULTS to the pg pool', async () => {
    const pool = createPool(DUMMY);
    try {
      for (const [key, value] of Object.entries(POOL_DEFAULTS)) {
        expect(pool.options[key as keyof typeof POOL_DEFAULTS], `pool.${key}`).toBe(value);
      }
    } finally {
      await pool.end();
    }
  });

  test('lets a caller override one bound without dropping the rest', async () => {
    const pool = createPool(DUMMY, { statement_timeout: 60_000 });
    try {
      expect(pool.options.statement_timeout).toBe(60_000);
      expect(pool.options.connectionTimeoutMillis).toBe(POOL_DEFAULTS.connectionTimeoutMillis);
    } finally {
      await pool.end();
    }
  });

  test("registers an 'error' listener so an idle-client failure cannot kill the process", async () => {
    const pool = createPool(DUMMY);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(pool.listenerCount('error')).toBe(1);
      // An EventEmitter 'error' with no listener throws; with one it logs.
      expect(() => pool.emit('error', new Error('connection terminated'))).not.toThrow();
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      await pool.end();
    }
  });
});
