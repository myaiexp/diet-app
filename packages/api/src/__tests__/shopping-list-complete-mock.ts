// Shared fixtures and db mock for shopping-list complete route tests

import { shoppingLists, shoppingListItems, ingredients, pantryItems } from '@diet-app/db';
import { makeDbMock } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { tableNameOf } from './drizzle-introspect.js';

export const LIST_ID = '11111111-1111-4111-8111-111111111111';
export const ITEM_BOUGHT_ID = '22222222-2222-4222-8222-222222222222';
export const ITEM_UNBOUGHT_ID = '33333333-3333-4333-8333-333333333333';
export const ITEM_ZERO_ID = '44444444-4444-4444-8444-444444444444';
export const ITEM_NO_SHELF_ID = '55555555-5555-4555-8555-555555555555';
export const ING_PRODUCE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const ING_NO_SHELF_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

export const LIST_DRAFT = {
  id: LIST_ID,
  weekStarting: '2026-08-03',
  status: 'draft',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

export const ITEM_BOUGHT = {
  id: ITEM_BOUGHT_ID,
  listId: LIST_ID,
  ingredientId: ING_PRODUCE_ID,
  quantityNeeded: '500',
  quantityInPantry: '0',
  netToBuy: '500',
  category: 'produce',
  unit: 'g',
  source: 'generated',
  bought: true,
  customNote: null,
};

export const ITEM_UNBOUGHT = { ...ITEM_BOUGHT, id: ITEM_UNBOUGHT_ID, bought: false };
export const ITEM_ZERO = { ...ITEM_BOUGHT, id: ITEM_ZERO_ID, netToBuy: '0' };
export const ITEM_NO_SHELF = {
  ...ITEM_BOUGHT,
  id: ITEM_NO_SHELF_ID,
  ingredientId: ING_NO_SHELF_ID,
  category: 'other',
};

export const ING_PRODUCE = {
  id: ING_PRODUCE_ID,
  name: 'Carrot',
  category: 'produce',
  defaultUnit: 'g',
  shelfLife: { fridge_days: 5, freezer_days: 180 },
};

export const ING_NO_SHELF = {
  id: ING_NO_SHELF_ID,
  name: 'Mystery item',
  category: 'other',
  defaultUnit: 'g',
  shelfLife: {},
};

type CompleteMockOpts = {
  list?: unknown | null;
  items?: unknown[];
  ingredientRows?: unknown[];
};

export function makeCompleteMock(opts: CompleteMockOpts = {}) {
  const resolveList = () => (opts.list === undefined ? { ...LIST_DRAFT } : opts.list);

  const router = makeSelectRouter([
    [
      shoppingLists,
      () => {
        const list = resolveList();
        return list == null ? [] : [list];
      },
    ],
    [shoppingListItems, opts.items ?? [{ ...ITEM_BOUGHT }]],
    [ingredients, opts.ingredientRows ?? [{ ...ING_PRODUCE }]],
  ]);

  let pantrySeq = 0;
  const mock = makeDbMock({
    select: router.select,
    insertRows: (_recorded, record) => {
      pantrySeq += 1;
      return [
        {
          id: `pantry-${pantrySeq}`,
          createdAt: new Date('2026-08-04T00:00:00Z'),
          updatedAt: new Date('2026-08-04T00:00:00Z'),
          ...(record.values as object),
        },
      ];
    },
    updateRows: (_recorded, record) => [
      { ...resolveList(), ...(record.values as object) },
    ],
  });

  const writesTo = (table: unknown) =>
    mock.writes.filter((w) => w.table === tableNameOf(table));

  return {
    db: mock.db,
    writes: mock.writes,
    pantryWrites: () => writesTo(pantryItems),
    listWrites: () => writesTo(shoppingLists),
    reads: router.reads,
  };
}

export function jsonReq(body?: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
