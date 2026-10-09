// PATCH /items/:id keeps quantityNeeded and netToBuy consistent (finding #11788).

import { describe, expect, test } from 'vitest';
import { shoppingLists, shoppingListItems } from '@diet-app/db';
import { shoppingListItemsRoutes } from '../routes/shopping-list-items.js';
import { makeDbMock, mergedRow } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const INGREDIENT_ID = '33333333-3333-4333-8333-333333333333';

const GENERATED = {
  id: ITEM_ID,
  listId: LIST_ID,
  ingredientId: INGREDIENT_ID,
  quantityNeeded: '400',
  quantityInPantry: '100',
  netToBuy: '300',
  category: 'produce',
  unit: 'g',
  source: 'generated',
  bought: false,
  customNote: null,
};

function mockItem(item: typeof GENERATED) {
  const router = makeSelectRouter([
    [shoppingLists, [{ id: LIST_ID, status: 'draft' }]],
    [shoppingListItems, [item]],
  ]);
  const mock = makeDbMock({
    select: router.select,
    txSelect: router.select,
    updateRows: mergedRow(item),
  });
  return mock;
}

function patch(db: unknown, body: unknown) {
  return shoppingListItemsRoutes(db as never).request(`/items/${ITEM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /items/:id quantities', () => {
  test('recomputes netToBuy when quantityNeeded changes on a generated row', async () => {
    const { db, updates } = mockItem(GENERATED);
    const res = await patch(db, { quantityNeeded: 2000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.netToBuy).toBe('1900');
    expect(body.quantityEdited).toBe(true);
    expect(updates[0]).toEqual({
      quantityNeeded: '2000',
      quantityInPantry: '100',
      netToBuy: '1900',
      quantityEdited: true,
    });
  });

  // The number /complete will file. Lowering demand under what the pantry
  // already covers must not leave the old net in place.
  test('files a zero net when the new demand is already covered', async () => {
    const { db, updates } = mockItem(GENERATED);
    const res = await patch(db, { quantityNeeded: 50 });
    expect(res.status).toBe(200);
    expect((await res.json()).netToBuy).toBe('0');
    expect(updates[0]).toMatchObject({ quantityInPantry: '50', netToBuy: '0', quantityEdited: true });
  });

  test('keeps a manual row\'s quantityNeeded and netToBuy equal', async () => {
    const manual = { ...GENERATED, source: 'manual', quantityNeeded: '500', quantityInPantry: '0', netToBuy: '500' };
    const { db, updates } = mockItem(manual);
    const res = await patch(db, { quantityNeeded: 2000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quantityNeeded).toBe('2000');
    expect(body.netToBuy).toBe('2000');
    expect(updates[0]).toEqual({
      quantityNeeded: '2000',
      quantityInPantry: '0',
      netToBuy: '2000',
      quantityEdited: true,
    });
  });

  test('rejects a pair that would store a stale net and does not write', async () => {
    const { db, updates } = mockItem(GENERATED);
    const res = await patch(db, { quantityNeeded: 2000, netToBuy: 300 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'quantityNeeded and netToBuy are inconsistent' });
    expect(updates).toHaveLength(0);
  });

  test('a bought toggle does not lock or rewrite quantities', async () => {
    const { db, updates } = mockItem(GENERATED);
    const res = await patch(db, { bought: true });
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual({ bought: true });
  });
});
