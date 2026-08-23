// Partial-file and location-keyed expiry on shopping-list complete

import { describe, test, expect, vi } from 'vitest';
import { shoppingListCompleteRoutes } from '../routes/shopping-list-complete.js';
import {
  LIST_ID,
  ITEM_BOUGHT,
  ITEM_BOUGHT_ID,
  ITEM_NO_SHELF,
  ITEM_NO_SHELF_ID,
  ING_PRODUCE,
  ING_PRODUCE_ID,
  ING_NO_SHELF,
  makeCompleteMock,
  jsonReq,
} from './shopping-list-complete-mock.js';

const ING_FREEZER_ONLY = { ...ING_PRODUCE, shelfLife: { freezer_days: 180 } };

describe('shoppingListCompleteRoutes filing contracts', () => {
  test('files survivors and reports no_shelf_life skips in the same complete', async () => {
    const { db, pantryWrites } = makeCompleteMock({
      // Skip first: aborting the transaction on the first skip would file nothing.
      items: [{ ...ITEM_NO_SHELF }, { ...ITEM_BOUGHT }],
      ingredientRows: [{ ...ING_PRODUCE }, { ...ING_NO_SHELF }],
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toHaveLength(1);
    expect(body.added[0].ingredientId).toBe(ING_PRODUCE_ID);
    expect(body.skipped).toEqual([{ itemId: ITEM_NO_SHELF_ID, reason: 'no_shelf_life' }]);
    expect(body.list.status).toBe('done');
    expect(pantryWrites()).toHaveLength(1);
    expect(pantryWrites()[0]!.values).toMatchObject({ ingredientId: ING_PRODUCE_ID });
  });

  test('skips an ingredient with only freezer_days when location defaults to fridge', async () => {
    const { db, pantryWrites } = makeCompleteMock({
      ingredientRows: [{ ...ING_FREEZER_ONLY }],
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([]);
    expect(body.skipped).toEqual([{ itemId: ITEM_BOUGHT_ID, reason: 'no_shelf_life' }]);
    expect(pantryWrites()).toHaveLength(0);
    expect(body.list.status).toBe('done');
  });

  test('files an ingredient with only freezer_days when overridden to freezer', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 4), toFake: ['Date'] });
    try {
      const { db, pantryWrites } = makeCompleteMock({
        ingredientRows: [{ ...ING_FREEZER_ONLY }],
      });
      const res = await shoppingListCompleteRoutes(db).request(
        `/${LIST_ID}/complete`,
        jsonReq({ overrides: [{ itemId: ITEM_BOUGHT_ID, location: 'freezer' }] }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.added).toHaveLength(1);
      expect(body.added[0]).toMatchObject({
        location: 'freezer',
        addedDate: '2026-08-04',
        expiresDate: '2027-01-31',
      });
      expect(body.skipped).toEqual([]);
      expect(pantryWrites()).toHaveLength(1);
      expect(pantryWrites()[0]!.values).toMatchObject({
        location: 'freezer',
        expiresDate: '2027-01-31',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
