// Mock-based route tests for adding shopping list items (POST /:id/items)

import { describe, test, expect } from 'vitest';
import { shoppingLists } from '@diet-app/db';
import { shoppingListItemsRoutes } from '../routes/shopping-list-items.js';
import { pgError } from './db-mock.js';
import { tableNameOf } from './drizzle-introspect.js';
import { LIST_ID, INGREDIENT_ID, makePostMock } from './shopping-list-items-test-helpers.js';

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
});
