// POST /shopping-lists/generate: create, validation, conflicts, optional lines

import { describe, test, expect } from 'vitest';
import {  } from 'drizzle-orm';
import { shoppingLists, shoppingListItems, recipes } from '@diet-app/db';
import { pgError, type ThrowOnWrite } from './db-mock.js';
import { renderWhere, tableNameOf } from './drizzle-introspect.js';
import {
  LIST_ID,
  ENTRY_ID,
  RECIPE_ID,
  ING_ID,
  MONDAY,
  THURSDAY_IN_WEEK,
  DRAFT_LIST,
  ENTRY,
  LINE,
  ITEM_ROW,
  makeGenerateMock,
  post,
  planFixtures,
} from './shopping-list-generate-test-helpers.js';

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
