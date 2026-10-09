// Edited shopping quantities survive regeneration and are what /complete files.
// Mocks pin the reconcile result and the upsert SQL; only Postgres can show
// that an edited triple survives regenerate and is what /complete inserts.

import { describe, expect, test } from 'vitest';
import { shoppingLists, shoppingListItems, pantryItems } from '@diet-app/db';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

const EDIT_MONDAY = '2026-11-16';
const EDIT_MID = '2026-11-19';
const MANUAL_MONDAY = '2026-11-23';

describe.skipIf(!hasDb)('shopping item quantities stay consistent', () => {
  async function call(path: string, method: string, body?: unknown) {
    const res = await app!.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  const findIngredient = async (q: string) => {
    const { status, body } = await call(`/api/ingredients?q=${encodeURIComponent(q)}&limit=5`, 'GET');
    expect(status).toBe(200);
    const exact = (body as { id: string; name: string }[]).find((row) => row.name.toLowerCase() === q);
    expect(exact, `seed should contain an ingredient named "${q}"`).toBeDefined();
    return exact!;
  };

  const itemFor = (items: Array<Record<string, unknown>>, ingredientId: string, unit: string) =>
    items.find((item) => item.ingredientId === ingredientId && item.unit === unit);

  async function deleteWeek(weekStarting: string) {
    const stale = await db!
      .select({ id: shoppingLists.id })
      .from(shoppingLists)
      .where(eq(shoppingLists.weekStarting, weekStarting));
    for (const row of stale) {
      await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, row.id));
      await db!.delete(shoppingLists).where(eq(shoppingLists.id, row.id));
    }
  }

  async function cleanup(opts: {
    ingredientIds: string[];
    listId?: string;
    entryId?: string;
    recipeId?: string;
  }) {
    await db!.delete(pantryItems).where(inArray(pantryItems.ingredientId, opts.ingredientIds));
    if (opts.listId) {
      await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, opts.listId));
      await db!.delete(shoppingLists).where(eq(shoppingLists.id, opts.listId));
    }
    if (opts.entryId) {
      const del = await call(`/api/meal-plans/${opts.entryId}`, 'DELETE');
      expect([204, 404]).toContain(del.status);
    }
    if (opts.recipeId) {
      const del = await call(`/api/recipes/${opts.recipeId}`, 'DELETE');
      expect([204, 404]).toContain(del.status);
    }
  }

  test('an edited generated quantity survives regeneration and is what /complete files', async () => {
    const apple = await findIngredient('apple');
    const artichoke = await findIngredient('artichoke');
    const ingredientIds = [apple.id, artichoke.id];
    let recipeId: string | undefined;
    let entryId: string | undefined;
    let listId: string | undefined;

    try {
      await db!.delete(pantryItems).where(inArray(pantryItems.ingredientId, ingredientIds));
      await deleteWeek(EDIT_MONDAY);

      const recipe = await call('/api/recipes', 'POST', {
        title: 'Quantity-edit smoke recipe',
        servings: 2,
        ingredients: [
          { ingredientId: apple.id, quantity: 2, unit: 'pieces' },
          { ingredientId: artichoke.id, quantity: 400, unit: 'g' },
        ],
      });
      expect(recipe.status).toBe(201);
      recipeId = recipe.body.id as string;

      const entry = await call('/api/meal-plans', 'POST', {
        date: EDIT_MID,
        slot: 'dinner',
        recipeId,
        servings: 2,
      });
      expect(entry.status).toBe(201);
      entryId = entry.body.id as string;

      const stocked = await call('/api/pantry', 'POST', {
        ingredientId: artichoke.id,
        quantity: 100,
        unit: 'g',
        location: 'fridge',
        expiresDate: '2099-12-31',
      });
      expect(stocked.status).toBe(201);

      const generated = await call('/api/shopping-lists/generate', 'POST', { weekStarting: EDIT_MONDAY });
      expect(generated.status).toBe(200);
      listId = generated.body.list.id as string;
      const artichokeItem = itemFor(generated.body.items, artichoke.id, 'g');
      const appleItem = itemFor(generated.body.items, apple.id, 'pieces');
      expect(artichokeItem).toMatchObject({
        quantityNeeded: '400',
        quantityInPantry: '100',
        netToBuy: '300',
        quantityEdited: false,
      });
      expect(appleItem).toMatchObject({ quantityNeeded: '2', netToBuy: '2', quantityEdited: false });

      const edited = await call(`/api/shopping-lists/items/${artichokeItem!.id}`, 'PATCH', {
        quantityNeeded: 1000,
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        quantityNeeded: '1000',
        quantityInPantry: '100',
        netToBuy: '900',
        quantityEdited: true,
      });

      // Reaffirming the plan's number must not lock the row.
      const reaffirm = await call(`/api/shopping-lists/items/${appleItem!.id}`, 'PATCH', {
        quantityNeeded: 2,
      });
      expect(reaffirm.status).toBe(200);
      expect(reaffirm.body).toMatchObject({ quantityNeeded: '2', netToBuy: '2', quantityEdited: false });

      expect((await call(`/api/shopping-lists/items/${appleItem!.id}`, 'PATCH', { bought: true })).status).toBe(200);
      expect((await call(`/api/meal-plans/${entryId}`, 'PATCH', { servings: 4 })).status).toBe(200);

      const regen = await call('/api/shopping-lists/generate', 'POST', { weekStarting: EDIT_MONDAY });
      expect(regen.status).toBe(200);
      // Plan now wants 800 g against 100 g covered → net 700. The edit stays.
      expect(itemFor(regen.body.items, artichoke.id, 'g')).toMatchObject({
        id: artichokeItem!.id,
        quantityNeeded: '1000',
        quantityInPantry: '100',
        netToBuy: '900',
        quantityEdited: true,
        source: 'generated',
      });
      expect(itemFor(regen.body.items, apple.id, 'pieces')).toMatchObject({
        quantityNeeded: '4',
        netToBuy: '4',
        quantityEdited: false,
        bought: true,
      });

      expect(
        (await call(`/api/shopping-lists/items/${artichokeItem!.id}`, 'PATCH', { bought: true })).status,
      ).toBe(200);
      const done = await call(`/api/shopping-lists/${listId}/complete`, 'POST', {});
      expect(done.status).toBe(200);
      expect(done.body.skipped).toEqual([]);
      const filed = (id: string) =>
        (done.body.added as { ingredientId: string; quantity: string; unit: string }[]).find(
          (row) => row.ingredientId === id,
        );
      // Not 300 (the pre-edit net) and not 700 (what regenerate would have written).
      expect(filed(artichoke.id)).toMatchObject({ quantity: '900', unit: 'g' });
      expect(filed(apple.id)).toMatchObject({ quantity: '4', unit: 'pieces' });
    } finally {
      await cleanup({ ingredientIds, listId, entryId, recipeId });
    }
  });

  test('a manual row keeps quantityNeeded and netToBuy equal, and complete files that amount', async () => {
    const banana = await findIngredient('banana');
    let listId: string | undefined;

    try {
      await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, banana.id));
      await deleteWeek(MANUAL_MONDAY);

      const generated = await call('/api/shopping-lists/generate', 'POST', { weekStarting: MANUAL_MONDAY });
      expect(generated.status).toBe(200);
      listId = generated.body.list.id as string;

      const created = await call(`/api/shopping-lists/${listId}/items`, 'POST', {
        ingredientId: banana.id,
        quantityNeeded: 1,
        unit: 'kg',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        quantityNeeded: '1000',
        quantityInPantry: '0',
        netToBuy: '1000',
        source: 'manual',
      });
      const itemId = created.body.id as string;

      const byNeeded = await call(`/api/shopping-lists/items/${itemId}`, 'PATCH', { quantityNeeded: 250 });
      expect(byNeeded.status).toBe(200);
      expect(byNeeded.body).toMatchObject({
        quantityNeeded: '250',
        quantityInPantry: '0',
        netToBuy: '250',
        quantityEdited: true,
      });

      const byNet = await call(`/api/shopping-lists/items/${itemId}`, 'PATCH', { netToBuy: 80 });
      expect(byNet.status).toBe(200);
      expect(byNet.body).toMatchObject({ quantityNeeded: '80', quantityInPantry: '0', netToBuy: '80' });

      const disagree = await call(`/api/shopping-lists/items/${itemId}`, 'PATCH', {
        quantityNeeded: 10,
        netToBuy: 4,
      });
      expect(disagree.status).toBe(400);
      expect(disagree.body).toEqual({ error: 'quantityNeeded and netToBuy are inconsistent' });

      const agree = await call(`/api/shopping-lists/items/${itemId}`, 'PATCH', {
        quantityNeeded: 10,
        netToBuy: 10,
      });
      expect(agree.status).toBe(200);
      expect(agree.body).toMatchObject({ quantityNeeded: '10', netToBuy: '10' });

      expect((await call(`/api/shopping-lists/items/${itemId}`, 'PATCH', { bought: true })).status).toBe(200);
      const done = await call(`/api/shopping-lists/${listId}/complete`, 'POST', {});
      expect(done.status).toBe(200);
      const filed = (done.body.added as { ingredientId: string; quantity: string }[]).find(
        (row) => row.ingredientId === banana.id,
      );
      // Not 1000 from the create, and not 250 from the earlier edit.
      expect(filed).toMatchObject({ quantity: '10' });
    } finally {
      await cleanup({ ingredientIds: [banana.id], listId });
    }
  });
});
