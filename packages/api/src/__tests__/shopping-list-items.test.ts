// Mock-based route tests for shoppingListItemsRoutes — deterministic, Postgres-free.

import { describe, test, expect } from 'vitest';
import { shoppingLists, shoppingListItems, ingredients } from '@diet-app/db';
import { shoppingListItemsRoutes } from '../routes/shopping-list-items.js';
import { makeDbMock, mergedRow, pgError } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { tableNameOf } from './drizzle-introspect.js';

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const INGREDIENT_ID = '33333333-3333-4333-8333-333333333333';

const EXISTING_ITEM = {
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

const LIST_DRAFT = { id: LIST_ID, status: 'draft' as const };

function makeItemsMock(
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

const makePostMock = makeItemsMock;
const makeWriteMock = makeItemsMock;

describe('shoppingListItemsRoutes', () => {
  describe('POST /:id/items', () => {
    test('rejects a malformed list id with 400 before touching the DB', async () => {
      const app = shoppingListItemsRoutes({} as any);
      const res = await app.request('/not-a-uuid/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'g' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid id format' });
    });

    test('adds a manual item with source manual and bought false', async () => {
      const { db, inserts } = makePostMock();
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 2, unit: 'g' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.source).toBe('manual');
      expect(body.bought).toBe(false);
      expect(body.quantityInPantry).toBe('0');
      expect(inserts[0]).toMatchObject({
        listId: LIST_ID,
        ingredientId: INGREDIENT_ID,
        source: 'manual',
        bought: false,
        quantityInPantry: '0',
      });
    });

    test('derives category from the ingredient rather than the request', async () => {
      const { db, inserts } = makePostMock({ ingredient: { id: INGREDIENT_ID, category: 'dairy' } });
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'l' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.category).toBe('dairy');
      expect(inserts[0]).toMatchObject({ category: 'dairy' });
    });

    test('normalizes the unit and quantity to the dimension base', async () => {
      const { db, inserts } = makePostMock();
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'kg' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.unit).toBe('g');
      expect(body.quantityNeeded).toBe('1000');
      // Manual rows never net against the pantry: netToBuy mirrors the
      // normalized quantityNeeded exactly, not a pantry-adjusted figure.
      expect(body.netToBuy).toBe('1000');
      expect(inserts[0]).toMatchObject({ unit: 'g', quantityNeeded: '1000', netToBuy: '1000' });
    });

    test('returns 409 when the normalized (ingredient, unit) already exists', async () => {
      const { db, inserts } = makePostMock({ throwOnWrite: pgError('23505') });
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'kg' }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toHaveProperty('error');
      expect(inserts).toHaveLength(1); // attempted, then mapped — not skipped
    });

    test('returns 400 for an unresolvable unit', async () => {
      const { db, inserts } = makePostMock();
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'banana' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
      expect(inserts).toHaveLength(0); // rejected before any write was attempted
    });

    test('returns 400 Invalid reference for an unknown ingredientId', async () => {
      const { db } = makePostMock({ ingredient: null });
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'g' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid reference' });
    });

    test('maps an FK violation (23503) on insert to the same 400 as the pre-check', async () => {
      // The ingredient was deleted between the pre-check and the insert — the
      // race has to be indistinguishable from the pre-check's own rejection.
      const { db, inserts } = makePostMock({ throwOnWrite: pgError('23503') });
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'g' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid reference' });
      expect(inserts).toHaveLength(1);
    });

    test('returns 404 when the list does not exist', async () => {
      const { db } = makePostMock({ list: null });
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'g' }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    });

    test('returns 409 when the parent list is done', async () => {
      const { db, inserts } = makePostMock({ list: { id: LIST_ID, status: 'done' } });
      const res = await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'g' }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Completed shopping list cannot be modified' });
      expect(inserts).toHaveLength(0);
    });

    test('locks the parent list FOR UPDATE before inserting', async () => {
      const { db, reads } = makePostMock();
      await shoppingListItemsRoutes(db).request(`/${LIST_ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID, quantityNeeded: 1, unit: 'g' }),
      });
      const listRead = reads.find((r) => r.table === tableNameOf(shoppingLists));
      expect(listRead?.forUpdate).toBe(true);
    });
  });

  describe('PATCH /items/:id', () => {
    test('rejects a malformed item id with 400 before touching the DB', async () => {
      const app = shoppingListItemsRoutes({} as any);
      const res = await app.request('/items/not-a-uuid', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bought: true }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid id format' });
    });

    test('toggles bought', async () => {
      const { db, updates } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bought: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.bought).toBe(true);
      expect(updates[0]).toEqual({ bought: true });
    });

    test('updates netToBuy and customNote', async () => {
      const { db, updates } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ netToBuy: 3, customNote: 'brand X only' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.netToBuy).toBe('3');
      expect(body.customNote).toBe('brand X only');
      expect(updates[0]).toEqual({ netToBuy: '3', customNote: 'brand X only' });
    });

    // Finding #7557: quantityNeeded is numeric in Postgres — Drizzle wants the
    // string form. The netToBuy case above already covers that sibling; a drop
    // of the quantityNeeded String() line would only show up on this PATCH.
    test('writes quantityNeeded as a string', async () => {
      const { db, updates } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantityNeeded: 2.5 }),
      });
      expect(res.status).toBe(200);
      expect(updates[0]).toEqual({ quantityNeeded: '2.5' });
      expect((updates[0] as { quantityNeeded: unknown }).quantityNeeded).toBe('2.5');
      const body = await res.json();
      expect(body.quantityNeeded).toBe('2.5');
    });

    test('clears customNote with null', async () => {
      const { db, updates } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customNote: null }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.customNote).toBeNull();
      expect(updates[0]).toEqual({ customNote: null });
    });

    test('returns 400 when the patch tries to change unit', async () => {
      const { db } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: 'kg' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    });

    test('returns 400 when the patch tries to change ingredientId', async () => {
      const { db } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId: INGREDIENT_ID }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    });

    test('returns 400 for an empty patch body', async () => {
      const { db } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    });

    test('returns 404 patching an unknown item', async () => {
      const { db } = makeWriteMock({ updateRows: [] });
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bought: true }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    });

    test('returns 409 when the parent list is done', async () => {
      const { db, updates } = makeWriteMock({ listStatus: 'done' });
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bought: true }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Completed shopping list cannot be modified' });
      expect(updates).toHaveLength(0);
    });

    test('locks the parent list FOR UPDATE before writing', async () => {
      const { db, reads } = makeWriteMock();
      await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bought: true }),
      });
      const listRead = reads.find((r) => r.table === tableNameOf(shoppingLists));
      expect(listRead?.forUpdate).toBe(true);
    });
  });

  describe('DELETE /items/:id', () => {
    test('rejects a malformed item id with 400 before touching the DB', async () => {
      const app = shoppingListItemsRoutes({} as any);
      const res = await app.request('/items/not-a-uuid', { method: 'DELETE' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid id format' });
    });

    test('deletes an item and returns 204', async () => {
      const { db, deletes } = makeWriteMock();
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(deletes).toHaveLength(1);
    });

    test('returns 404 deleting an unknown item', async () => {
      const { db } = makeWriteMock({ deleteRows: [] });
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    });

    test('returns 409 when the parent list is done', async () => {
      const { db, deletes } = makeWriteMock({ listStatus: 'done' });
      const res = await shoppingListItemsRoutes(db).request(`/items/${ITEM_ID}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Completed shopping list cannot be modified' });
      expect(deletes).toHaveLength(0);
    });
  });
});
