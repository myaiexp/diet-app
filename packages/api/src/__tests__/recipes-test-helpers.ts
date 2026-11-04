// Shared fixtures and the write-path db mock for the recipes route suites.

import { vi } from 'vitest';
import type { Table } from 'drizzle-orm';
import { mealPlanEntries, recipes } from '@diet-app/db';
import { makeDbMock, pgError, type DbMock, type ThrowOnWrite } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { tableNameOf } from './drizzle-introspect.js';

export const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const INGREDIENT_ID = '11111111-1111-4111-8111-111111111111';

export const RECIPE_WITH_RELATIONS = {
  id: RECIPE_ID,
  title: 'Roast chicken',
  sourceType: 'manual',
  servings: 2,
  recipeIngredients: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      quantity: '500',
      unit: 'g',
      ingredient: { id: INGREDIENT_ID, name: 'Chicken' },
    },
  ],
};

export const VALID_CREATE = {
  title: 'Roast chicken',
  ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 500, unit: 'g' }],
};

export type WriteMockOpts = {
  findFirst?: unknown | null | (() => unknown);
  mealPlanRefs?: unknown[];
  childRecipes?: unknown[];
  /** Fail a matching write with a driver-shaped error (see db-mock). */
  throwOnWrite?: ThrowOnWrite;
};

/**
 * Fail the write that touches `table` with a Postgres FK violation. Every
 * recipe write path spans two tables inside one transaction, so which one the
 * database rejects is the whole point: an unknown ingredientId breaks the
 * recipe_ingredients insert, a still-referenced recipe breaks the recipes delete.
 */
export const fkViolationOn =
  (table: Table): ThrowOnWrite =>
  (record) =>
    record.table === tableNameOf(table) ? pgError('23503') : undefined;

export function makeWriteMock(opts: WriteMockOpts = {}) {
  let mock: DbMock;

  const resolveFind = () => {
    if (typeof opts.findFirst === 'function') return (opts.findFirst as () => unknown)();
    if (opts.findFirst !== undefined) return opts.findFirst;
    // Pre-write reads are existence checks (the handler only needs an id); the
    // reload after a write is what the response is built from, so it carries
    // the full relation shape. Keyed on whether a write has landed rather than
    // on call count, so an extra pre-check can't shift the fixtures.
    return mock.writes.length === 0
      ? { id: RECIPE_ID, title: 'Roast chicken' }
      : RECIPE_WITH_RELATIONS;
  };

  mock = makeDbMock({
    insertRows: () => [{ id: RECIPE_ID, title: VALID_CREATE.title, sourceType: 'manual' }],
    // DELETE pre-checks meal-plan references, then forked child recipes.
    select: makeSelectRouter([
      [mealPlanEntries, opts.mealPlanRefs ?? []],
      [recipes, opts.childRecipes ?? []],
    ]).select,
    query: {
      recipes: {
        findFirst: vi.fn(async () => resolveFind()),
      },
    },
    throwOnWrite: opts.throwOnWrite,
  });
  return mock;
}
