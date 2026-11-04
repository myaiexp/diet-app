// Shared fixtures, db mock and request helper for the shopping-list generate tests

import { PgDialect } from 'drizzle-orm/pg-core';
import {
  shoppingLists,
  mealPlanEntries,
  recipes,
  recipeIngredients,
  pantryItems,
  ingredients,
} from '@diet-app/db';
import { shoppingListGenerateRoutes } from '../routes/shopping-list-generate.js';
import { makeDbMock, type ThrowOnWrite } from './db-mock.js';
import { makeSelectRouter, type SelectFixture } from './select-router.js';
import { tableNameOf } from './drizzle-introspect.js';

export const dialect = new PgDialect();

export function renderSql(value: unknown): string {
  return dialect.sqlToQuery(value as never).sql;
}

export const LIST_ID = '11111111-1111-4111-8111-111111111111';
export const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
export const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
export const ING_ID = '44444444-4444-4444-8444-444444444444';
export const PANTRY_ID = '55555555-5555-4555-8555-555555555555';

// 2026-08-06 is a Thursday; its ISO week runs Monday 2026-08-03 .. Sunday 2026-08-09.
export const MONDAY = '2026-08-03';
export const THURSDAY_IN_WEEK = '2026-08-06';
export const NOW = new Date('2026-08-04T00:00:00Z');

export const DRAFT_LIST = {
  id: LIST_ID,
  weekStarting: MONDAY,
  status: 'draft',
  createdAt: NOW,
  updatedAt: NOW,
};

export const ENTRY = {
  id: ENTRY_ID,
  date: '2026-08-04',
  slot: 'dinner',
  recipeId: RECIPE_ID,
  freeformNote: null,
  servings: '2',
  status: 'planned',
  substituteRecipeId: null,
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
};

export const RECIPE = { id: RECIPE_ID, title: 'Soup', servings: 2 };

export const LINE = {
  id: '66666666-6666-4666-8666-666666666666',
  recipeId: RECIPE_ID,
  ingredientId: ING_ID,
  quantity: '400',
  unit: 'g',
  optional: false,
  notes: null,
};

export const PANTRY_ROW = {
  id: PANTRY_ID,
  ingredientId: ING_ID,
  quantity: '100',
  unit: 'g',
  location: 'fridge',
  addedDate: '2026-07-01',
  expiresDate: '2026-12-01',
  opened: false,
};

export const INGREDIENT = { id: ING_ID, name: 'Carrot', category: 'produce', isStaple: false };

// aggregateShoppingList's output for ENTRY/RECIPE/LINE/PANTRY_ROW above:
// scale 2/2=1, demand 400g, pantry 100g → net 300g. This is what the route
// must insert (as strings) and what the final read-back below represents.
export const ITEM_ROW = {
  id: '77777777-7777-4777-8777-777777777777',
  listId: LIST_ID,
  ingredientId: ING_ID,
  quantityNeeded: '400',
  quantityInPantry: '100',
  netToBuy: '300',
  category: 'produce',
  unit: 'g',
  source: 'generated',
  bought: false,
  customNote: null,
  ingredient: INGREDIENT,
};

export type GenMockOpts = {
  existingList?: unknown | null;
  entries?: unknown[];
  recipes?: unknown[];
  lines?: unknown[];
  pantryRows?: unknown[];
  ingredients?: unknown[];
  findManyItems?: unknown[];
  throwOnWrite?: ThrowOnWrite;
};

export function makeGenerateMock(opts: GenMockOpts = {}) {
  let transactionOpened = false;

  const listFixture: SelectFixture = () =>
    opts.existingList === undefined ? [] : opts.existingList === null ? [] : [opts.existingList];

  const router = makeSelectRouter([
    [shoppingLists, listFixture],
    [mealPlanEntries, opts.entries ?? []],
    [recipes, opts.recipes ?? []],
    [recipeIngredients, opts.lines ?? []],
    [pantryItems, opts.pantryRows ?? []],
    [ingredients, opts.ingredients ?? []],
  ]);

  const mock = makeDbMock({
    txSelect: router.select,
    // Only the shoppingLists insert calls .returning() — the shoppingListItems
    // upsert never reads a row back, so this fixture only ever answers for one
    // table, but keys on it anyway rather than assuming.
    insertRows: (_recorded, record) =>
      record.table === tableNameOf(shoppingLists)
        ? [{ ...DRAFT_LIST, ...(record.values as object) }]
        : [],
    throwOnWrite: opts.throwOnWrite,
    beforeTransaction: () => {
      transactionOpened = true;
    },
    query: {
      shoppingListItems: {
        findMany: async () => opts.findManyItems ?? [],
      },
    },
  });

  const writesTo = (kind: 'insert' | 'update' | 'delete', table: unknown) =>
    mock.writes.filter((w) => w.kind === kind && w.table === tableNameOf(table));

  return {
    db: mock.db,
    writes: mock.writes,
    reads: router.reads,
    wasOpened: () => transactionOpened,
    insertsTo: (table: unknown) => writesTo('insert', table),
    deletesTo: (table: unknown) => writesTo('delete', table),
  };
}

export function post(db: unknown, body: unknown) {
  return shoppingListGenerateRoutes(db as any).request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Standard "one item, one existing/new list" fixture set shared by the happy-path
// and regeneration tests below.
export function planFixtures(existingList: unknown | null = null): GenMockOpts {
  return {
    existingList,
    entries: [ENTRY],
    recipes: [RECIPE],
    lines: [LINE],
    pantryRows: [PANTRY_ROW],
    ingredients: [INGREDIENT],
    findManyItems: [ITEM_ROW],
  };
}
