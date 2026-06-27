// Structural wiring tests for createDb — verifies the pg.Pool → drizzle hookup
// and full-schema registration WITHOUT opening a real connection. pg.Pool is
// lazy (it connects on first query/.connect()), so constructing one against a
// dummy connection string never touches the network here.

import { describe, test, expect } from 'vitest';
import { createDb } from '../connection.js';

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
