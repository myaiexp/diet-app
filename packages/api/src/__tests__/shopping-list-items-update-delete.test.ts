// Shopping list item edits and deletes (PATCH and DELETE /items/:id)

import { describe, test, expect } from 'vitest';
import { shoppingLists } from '@diet-app/db';
import { shoppingListItemsRoutes } from '../routes/shopping-list-items.js';
import { tableNameOf } from './drizzle-introspect.js';
import { ITEM_ID, INGREDIENT_ID, makeWriteMock } from './shopping-list-items-test-helpers.js';

describe('shoppingListItemsRoutes', () => {
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
      expect(body.quantityNeeded).toBe('3');
      expect(body.customNote).toBe('brand X only');
      // Manual rows keep the two equal. A net-only edit moves demand with it
      // and locks the row so a later regenerate cannot put the old amount back.
      expect(updates[0]).toEqual({
        quantityNeeded: '3',
        quantityInPantry: '0',
        netToBuy: '3',
        quantityEdited: true,
        customNote: 'brand X only',
      });
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
      expect(updates[0]).toEqual({
        quantityNeeded: '2.5',
        quantityInPantry: '0',
        netToBuy: '2.5',
        quantityEdited: true,
      });
      expect((updates[0] as { quantityNeeded: unknown }).quantityNeeded).toBe('2.5');
      const body = await res.json();
      expect(body.quantityNeeded).toBe('2.5');
      expect(body.netToBuy).toBe('2.5');
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
