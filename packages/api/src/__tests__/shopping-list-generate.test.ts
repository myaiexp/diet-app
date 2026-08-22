// Mock-based tests for POST /shopping-lists/generate (meal plan → shopping list)

import { describe, test, expect } from 'vitest';
import { and, eq, not, or } from 'drizzle-orm';
import {
  shoppingLists,
  shoppingListItems,
  mealPlanEntries,
  recipes,
  recipeIngredients,
  pantryItems,
  ingredients,
} from '@diet-app/db';
import { shoppingListGenerateRoutes } from '../routes/shopping-list-generate.js';
import { makeDbMock, pgError, type ThrowOnWrite } from './db-mock.js';
import { makeSelectRouter, type SelectFixture } from './select-router.js';
import { tableNameOf, renderWhere } from './drizzle-introspect.js';

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const ING_ID = '44444444-4444-4444-8444-444444444444';
const PANTRY_ID = '55555555-5555-4555-8555-555555555555';

// 2026-08-06 is a Thursday; its ISO week runs Monday 2026-08-03 .. Sunday 2026-08-09.
const MONDAY = '2026-08-03';
const THURSDAY_IN_WEEK = '2026-08-06';
const NOW = new Date('2026-08-04T00:00:00Z');

const DRAFT_LIST = {
  id: LIST_ID,
  weekStarting: MONDAY,
  status: 'draft',
  createdAt: NOW,
  updatedAt: NOW,
};

const ENTRY = {
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

const RECIPE = { id: RECIPE_ID, title: 'Soup', servings: 2 };

const LINE = {
  id: '66666666-6666-4666-8666-666666666666',
  recipeId: RECIPE_ID,
  ingredientId: ING_ID,
  quantity: '400',
  unit: 'g',
  optional: false,
  notes: null,
};

const PANTRY_ROW = {
  id: PANTRY_ID,
  ingredientId: ING_ID,
  quantity: '100',
  unit: 'g',
  location: 'fridge',
  addedDate: '2026-07-01',
  expiresDate: '2026-12-01',
  opened: false,
};

const INGREDIENT = { id: ING_ID, name: 'Carrot', category: 'produce', isPantryStaple: false };

// aggregateShoppingList's output for ENTRY/RECIPE/LINE/PANTRY_ROW above:
// scale 2/2=1, demand 400g, pantry 100g → net 300g. This is what the route
// must insert (as strings) and what the final read-back below represents.
const ITEM_ROW = {
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

type GenMockOpts = {
  existingList?: unknown | null;
  entries?: unknown[];
  recipes?: unknown[];
  lines?: unknown[];
  pantryRows?: unknown[];
  ingredients?: unknown[];
  findManyItems?: unknown[];
  throwOnWrite?: ThrowOnWrite;
};

function makeGenerateMock(opts: GenMockOpts = {}) {
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

function post(db: unknown, body: unknown) {
  return shoppingListGenerateRoutes(db as any).request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Standard "one item, one existing/new list" fixture set shared by the happy-path
// and regeneration tests below.
function planFixtures(existingList: unknown | null = null): GenMockOpts {
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

describe('shoppingListGenerateRoutes', () => {
  test('creates a list and its items for a week with no existing list', async () => {
    const mock = makeGenerateMock(planFixtures(null));
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.list.weekStarting).toBe(MONDAY);
    expect(body.skipped).toEqual([]);
    expect(body.items).toEqual([ITEM_ROW]);

    expect(mock.insertsTo(shoppingLists)).toHaveLength(1);
    const itemInsert = mock.insertsTo(shoppingListItems)[0]!;
    expect(itemInsert.values).toEqual([
      {
        listId: LIST_ID,
        ingredientId: ING_ID,
        unit: 'g',
        quantityNeeded: '400',
        quantityInPantry: '100',
        netToBuy: '300',
        category: 'produce',
      },
    ]);
  });

  test('snaps a mid-week date to the ISO Monday', async () => {
    const mock = makeGenerateMock(planFixtures(null));
    const res = await post(mock.db, { weekStarting: THURSDAY_IN_WEEK });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.list.weekStarting).toBe(MONDAY);

    // The list lookup/insert must have used the snapped Monday, not the raw input.
    const listRead = mock.reads.find((r) => r.table === tableNameOf(shoppingLists));
    expect(listRead?.params).toContain(MONDAY);
    expect(mock.insertsTo(shoppingLists)[0]!.values).toMatchObject({ weekStarting: MONDAY });
  });

  test('returns 400 for a malformed weekStarting', async () => {
    const mock = makeGenerateMock();
    const res = await post(mock.db, { weekStarting: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(mock.wasOpened()).toBe(false);
  });

  test('returns 400 for an unknown body field', async () => {
    const mock = makeGenerateMock();
    const res = await post(mock.db, { weekStarting: MONDAY, extra: 'nope' });
    expect(res.status).toBe(400);
    expect(mock.wasOpened()).toBe(false);
  });

  test('rewrites quantities on regeneration without touching bought', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(200);

    const itemInsert = mock.insertsTo(shoppingListItems)[0]!;
    expect(itemInsert.conflict?.target).toEqual([
      shoppingListItems.listId,
      shoppingListItems.ingredientId,
      shoppingListItems.unit,
    ]);
    const setKeys = Object.keys(itemInsert.conflict?.set as object);
    expect(setKeys.sort()).toEqual(['category', 'netToBuy', 'quantityInPantry', 'quantityNeeded'].sort());
    expect(setKeys).not.toContain('bought');
    // Without this, a colliding manual row (same list/ingredient/unit) is
    // rewritten by the plan's numbers — the documented "never revisit manual
    // rows" contract. The prune is already source-scoped; the upsert must be too.
    expect(itemInsert.conflict?.setWhere).toEqual(eq(shoppingListItems.source, 'generated'));
  });

  test('preserves customNote on regeneration', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    await post(mock.db, { weekStarting: MONDAY });
    const itemInsert = mock.insertsTo(shoppingListItems)[0]!;
    expect(Object.keys(itemInsert.conflict?.set as object)).not.toContain('customNote');
    expect(Object.keys(itemInsert.conflict?.set as object)).not.toContain('source');
  });

  test('preserves manual rows absent from the plan (delete predicate is source-scoped)', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    await post(mock.db, { weekStarting: MONDAY });
    const del = mock.deletesTo(shoppingListItems)[0]!;
    const { sql, params } = renderWhere(del.where);
    expect(sql).toContain('source');
    expect(params).toContain('generated');
    // A manual row can never match this predicate regardless of the plan, since
    // the predicate only ever selects source = 'generated' rows.
    expect(params).not.toContain('manual');
  });

  test('keeps a generated row that was already bought even when the plan drops it', async () => {
    // Empty plan this time: the fresh item list is empty, so the only thing
    // standing between "drop everything" and "keep bought rows" is the
    // bought = false term in the delete predicate.
    const mock = makeGenerateMock({ existingList: DRAFT_LIST, findManyItems: [] });
    await post(mock.db, { weekStarting: MONDAY });
    const del = mock.deletesTo(shoppingListItems)[0]!;
    expect(del.where).toEqual(
      and(
        eq(shoppingListItems.listId, LIST_ID),
        eq(shoppingListItems.source, 'generated'),
        eq(shoppingListItems.bought, false),
      ),
    );
  });

  test('deletes generated unbought rows the plan no longer calls for', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    await post(mock.db, { weekStarting: MONDAY });
    const del = mock.deletesTo(shoppingListItems)[0]!;
    // Structurally: only rows matching this week's (ingredient, unit) survive;
    // everything else generated-and-unbought is deleted by the NOT(OR(...)).
    expect(del.where).toEqual(
      and(
        eq(shoppingListItems.listId, LIST_ID),
        eq(shoppingListItems.source, 'generated'),
        eq(shoppingListItems.bought, false),
        not(or(and(eq(shoppingListItems.ingredientId, ING_ID), eq(shoppingListItems.unit, 'g')))!),
      ),
    );
  });

  test('returns 409 when the existing list is not draft', async () => {
    const shoppingList = { ...DRAFT_LIST, status: 'shopping' };
    const mock = makeGenerateMock({ existingList: shoppingList });
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Shopping list for this week is not a draft' });
    // No further reads or writes past the locked list lookup.
    expect(mock.reads.map((r) => r.table)).toEqual([tableNameOf(shoppingLists)]);
    expect(mock.writes).toHaveLength(0);
  });

  test('returns 409 on a unique violation for week_starting', async () => {
    const throwOnWrite: ThrowOnWrite = (record) =>
      record.table === tableNameOf(shoppingLists) ? pgError('23505') : undefined;
    const mock = makeGenerateMock({ existingList: null, throwOnWrite });
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Shopping list for this week already exists' });
    expect(mock.insertsTo(shoppingListItems)).toHaveLength(0);
  });

  test('returns skipped lines from the aggregator in the response', async () => {
    const missingRecipeEntry = { ...ENTRY, recipeId: RECIPE_ID };
    const mock = makeGenerateMock({
      existingList: null,
      entries: [missingRecipeEntry],
      recipes: [], // the referenced recipe is gone
      lines: [],
      findManyItems: [],
    });
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toEqual([{ ingredientId: null, entryId: ENTRY_ID, reason: 'recipe_missing' }]);
    expect(body.items).toEqual([]);
    // No demand at all → nothing to upsert.
    expect(mock.insertsTo(shoppingListItems)).toHaveLength(0);
  });

  test('creates an empty list when the week has no entries', async () => {
    const mock = makeGenerateMock({ existingList: null, entries: [], findManyItems: [] });
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(mock.insertsTo(shoppingListItems)).toHaveLength(0);

    // No fresh items → no NOT(OR(...)) term, just the three base conditions.
    const del = mock.deletesTo(shoppingListItems)[0]!;
    const { sql } = renderWhere(del.where);
    expect(sql).not.toContain('not');
  });

  test('locks the target week row FOR UPDATE', async () => {
    const mock = makeGenerateMock(planFixtures(null));
    await post(mock.db, { weekStarting: MONDAY });
    const listRead = mock.reads.find((r) => r.table === tableNameOf(shoppingLists));
    expect(listRead?.forUpdate).toBe(true);
  });

  test('loads only the resolved recipe id for a substituted entry', async () => {
    const SUB_ID = '88888888-8888-4888-8888-888888888888';
    const mock = makeGenerateMock({
      ...planFixtures(null),
      entries: [
        {
          ...ENTRY,
          recipeId: RECIPE_ID,
          substituteRecipeId: SUB_ID,
          status: 'substituted',
        },
      ],
      recipes: [{ id: SUB_ID, title: 'Alt soup', servings: 2 }],
      lines: [{ ...LINE, recipeId: SUB_ID }],
    });
    await post(mock.db, { weekStarting: MONDAY });
    const recipeRead = mock.reads.find((r) => r.table === tableNameOf(recipes));
    const loaded = recipeRead?.params.flat() ?? [];
    expect(loaded).toContain(SUB_ID);
    expect(loaded).not.toContain(RECIPE_ID);
  });

  test('skips an optional recipe line by default', async () => {
    const mock = makeGenerateMock({
      ...planFixtures(null),
      lines: [{ ...LINE, optional: true }],
      findManyItems: [],
    });
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(200);
    expect(mock.insertsTo(shoppingListItems)).toHaveLength(0);
  });

  test('buys an optional recipe line when includeOptional is set', async () => {
    const mock = makeGenerateMock({
      ...planFixtures(null),
      lines: [{ ...LINE, optional: true }],
    });
    const res = await post(mock.db, { weekStarting: MONDAY, includeOptional: true });
    expect(res.status).toBe(200);

    const itemInsert = mock.insertsTo(shoppingListItems)[0]!;
    expect(itemInsert.values).toEqual([
      {
        listId: LIST_ID,
        ingredientId: ING_ID,
        unit: 'g',
        quantityNeeded: '400',
        quantityInPantry: '100',
        netToBuy: '300',
        category: 'produce',
      },
    ]);
  });
});
