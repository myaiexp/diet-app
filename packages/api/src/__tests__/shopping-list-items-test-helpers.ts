// Shared fixtures and db mock for the shopping-list items route tests

import { shoppingLists, shoppingListItems, ingredients } from '@diet-app/db';
import { makeDbMock, mergedRow } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';

export const LIST_ID = '11111111-1111-4111-8111-111111111111';
export const ITEM_ID = '22222222-2222-4222-8222-222222222222';
export const INGREDIENT_ID = '33333333-3333-4333-8333-333333333333';

export const EXISTING_ITEM = {
  id: ITEM_ID,
  listId: LIST_ID,
  ingredientId: INGREDIENT_ID,
  quantityNeeded: '500',
  quantityInPantry: '0',
  netToBuy: '500',
  category: 'produce',
  unit: 'g',
  source: 'manual',
  bought: false,
  customNote: null,
};

export const LIST_DRAFT = { id: LIST_ID, status: 'draft' as const };

export function makeItemsMock(
  opts: {
    /** Existing shopping list for the lock; null → 404. */
    list?: { id: string; status: string } | null;
    /** Parent-list status when `list` is omitted. */
    listStatus?: string;
    /** Item row PATCH/DELETE peek; null → 404. */
    item?: typeof EXISTING_ITEM | null;
    /** Ingredient row read for category derivation; null → 400 Invalid reference. */
    ingredient?: { id: string; category: string } | null;
    /** Full RETURNING array for UPDATE — pass [] for the 404 (missing item) case. */
    updateRows?: unknown[];
    deleteRows?: unknown[];
    throwOnWrite?: unknown;
  } = {},
) {
  const listRow =
    opts.list === undefined
      ? { ...LIST_DRAFT, status: opts.listStatus ?? 'draft' }
      : opts.list;
  const itemRow = opts.item === undefined ? EXISTING_ITEM : opts.item;
  const ingredientRow =
    opts.ingredient === undefined ? { id: INGREDIENT_ID, category: 'produce' } : opts.ingredient;

  const router = makeSelectRouter([
    [shoppingLists, listRow == null ? [] : [listRow]],
    [shoppingListItems, itemRow == null ? [] : [itemRow]],
    [ingredients, ingredientRow == null ? [] : [ingredientRow]],
  ]);

  const mock = makeDbMock({
    select: router.select,
    txSelect: router.select,
    throwOnWrite: opts.throwOnWrite !== undefined ? () => opts.throwOnWrite : undefined,
    // id comes from the fixture (the route never sets it); every other column
    // comes straight from what the handler actually inserted, so each test
    // asserts against the real write instead of a hand-duplicated row.
    insertRows: mergedRow({ id: ITEM_ID }),
    updateRows: opts.updateRows !== undefined ? () => opts.updateRows! : mergedRow(EXISTING_ITEM),
    deleteRows: () => opts.deleteRows ?? [{ id: ITEM_ID }],
  });

  return { ...mock, reads: router.reads };
}

export const makePostMock = makeItemsMock;
export const makeWriteMock = makeItemsMock;
