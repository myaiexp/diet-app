// Real-Postgres smoke: /current and the generate → tick → hand-add → regenerate → complete round trip

import { describe, test, expect } from 'vitest';
import { shoppingLists, shoppingListItems, pantryItems } from '@diet-app/db';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';
import { shoppingSqlHelpers } from './shopping-sql-helpers.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;
const { json, findIngredient, itemFor } = shoppingSqlHelpers(app);

describe.skipIf(!hasDb)('GET /api/shopping-lists', () => {
  // Real-schema contract check: whichever branch the test DB produces, assert the
  // matching body shape (not just the status). Deterministic 200/404 coverage is
  // in shopping-lists.test.ts.
  test('/current returns a list (200) or a not-found error (404)', async () => {
    const res = await app!.request('/api/shopping-lists/current');
    const body = await res.json();
    if (res.status === 200) {
      expect(body).toHaveProperty('id');
      expect(Array.isArray(body.items)).toBe(true);
    } else {
      expect(res.status).toBe(404);
      expect(body).toEqual({ error: 'Not found' });
    }
  });
});

describe.skipIf(!hasDb)('shopping list flow', () => {
  // Thursday; generate must snap it back to Monday 2026-09-07.
  const MID_WEEK = '2026-09-10';
  const MONDAY = '2026-09-07';

  test('generate → tick → hand-add → regenerate → complete round trip', async () => {
    const apple = await findIngredient('apple'); // produce, pieces
    const artichoke = await findIngredient('artichoke'); // produce, g
    const banana = await findIngredient('banana'); // the manual add
    const ingredientIds = [apple.id, artichoke.id, banana.id];

    let recipeId: string | undefined;
    let entryId: string | undefined;
    let listId: string | undefined;

    try {
      // Leftovers from an interrupted run would skew the pantry netting below.
      await db!.delete(pantryItems).where(inArray(pantryItems.ingredientId, ingredientIds));
      const stale = await db!
        .select({ id: shoppingLists.id })
        .from(shoppingLists)
        .where(eq(shoppingLists.weekStarting, MONDAY));
      for (const row of stale) {
        await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, row.id));
        await db!.delete(shoppingLists).where(eq(shoppingLists.id, row.id));
      }

      // 1. Recipe (servings 2): 2 pieces apple + 400 g artichoke.
      const recipeRes = await app!.request(
        '/api/recipes',
        json('POST', {
          title: 'Shopping-list smoke recipe',
          servings: 2,
          ingredients: [
            { ingredientId: apple.id, quantity: 2, unit: 'pieces' },
            { ingredientId: artichoke.id, quantity: 400, unit: 'g' },
          ],
        }),
      );
      expect(recipeRes.status).toBe(201);
      recipeId = (await recipeRes.json()).id as string;

      // 2. One planned dinner at servings 4 → scale 2 → 4 pieces + 800 g.
      const entryRes = await app!.request(
        '/api/meal-plans',
        json('POST', { date: MID_WEEK, slot: 'dinner', recipeId, servings: 4 }),
      );
      expect(entryRes.status).toBe(201);
      entryId = (await entryRes.json()).id as string;

      // 3. 100 g of artichoke already in the pantry → netToBuy 700, not 800.
      const pantryRes = await app!.request(
        '/api/pantry',
        json('POST', {
          ingredientId: artichoke.id,
          quantity: 100,
          unit: 'g',
          location: 'fridge',
          expiresDate: '2099-12-31',
        }),
      );
      expect(pantryRes.status).toBe(201);

      // 4. Generate — the mid-week date snaps to the ISO Monday.
      const genRes = await app!.request('/api/shopping-lists/generate', json('POST', { weekStarting: MID_WEEK }));
      expect(genRes.status).toBe(200);
      const generated = await genRes.json();
      listId = generated.list.id as string;
      expect(generated.list.weekStarting).toBe(MONDAY);
      expect(generated.skipped).toEqual([]);

      const appleItem = itemFor(generated.items, apple.id, 'pieces');
      const artichokeItem = itemFor(generated.items, artichoke.id, 'g');
      expect(appleItem, 'apple row in pieces').toBeDefined();
      expect(appleItem.netToBuy).toBe('4');
      expect(appleItem.source).toBe('generated');
      // Real pantry netting, computed by Postgres numerics round-tripping
      // through the aggregator — the half mocks structurally cannot prove.
      expect(artichokeItem.quantityNeeded).toBe('800');
      expect(artichokeItem.quantityInPantry).toBe('100');
      expect(artichokeItem.netToBuy).toBe('700');

      // 5. Tick the apple off and hand-add a banana in kg.
      const tick = await app!.request(
        `/api/shopping-lists/items/${appleItem.id}`,
        json('PATCH', { bought: true, customNote: 'the big ones' }),
      );
      expect(tick.status).toBe(200);

      const manual = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: banana.id, quantityNeeded: 1, unit: 'kg' }),
      );
      expect(manual.status).toBe(201);
      const manualItem = await manual.json();
      // Normalized before the write, which is what lets the unique index see a
      // kg add and a generated g row as the same thing.
      expect(manualItem.unit).toBe('g');
      expect(manualItem.quantityNeeded).toBe('1000');
      expect(manualItem.source).toBe('manual');
      expect(manualItem.category).toBe(banana.category);

      // 6. A kg add against the existing g row must collide, not duplicate.
      const dupe = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: artichoke.id, quantityNeeded: 1, unit: 'kg' }),
      );
      expect(dupe.status).toBe(409);

      // 7. Skip the dinner, then regenerate: the plan now calls for nothing.
      const skip = await app!.request(`/api/meal-plans/${entryId}`, json('PATCH', { status: 'skipped' }));
      expect(skip.status).toBe(200);

      const regen = await app!.request('/api/shopping-lists/generate', json('POST', { weekStarting: MONDAY }));
      expect(regen.status).toBe(200);
      const regenerated = await regen.json();
      expect(regenerated.list.id).toBe(listId);

      // The bought row survives (that food is still going in the basket) and
      // keeps its note; the manual row was never generation's to prune; the
      // unbought generated row is gone.
      const appleAfter = itemFor(regenerated.items, apple.id, 'pieces');
      expect(appleAfter, 'bought generated row must survive a regeneration').toBeDefined();
      expect(appleAfter.bought).toBe(true);
      expect(appleAfter.customNote).toBe('the big ones');
      expect(itemFor(regenerated.items, banana.id, 'g'), 'manual row must survive').toBeDefined();
      expect(itemFor(regenerated.items, artichoke.id, 'g'), 'unbought generated row is pruned').toBeUndefined();

      // 8. Complete: bought items with netToBuy > 0 become real pantry rows.
      const buyManual = await app!.request(
        `/api/shopping-lists/items/${manualItem.id}`,
        json('PATCH', { bought: true }),
      );
      expect(buyManual.status).toBe(200);

      const done = await app!.request(`/api/shopping-lists/${listId}/complete`, json('POST', {}));
      expect(done.status).toBe(200);
      const completed = await done.json();
      expect(completed.list.status).toBe('done');
      expect(completed.skipped).toEqual([]);
      expect(completed.added).toHaveLength(2);

      // produce → fridge → shelfLife.fridge_days (7 in the seed data).
      const today = new Date().toISOString().slice(0, 10);
      const expected = new Date(`${today}T00:00:00.000Z`);
      expected.setUTCDate(expected.getUTCDate() + 7);
      const expectedExpiry = expected.toISOString().slice(0, 10);

      const addedApple = completed.added.find((r: any) => r.ingredientId === apple.id);
      expect(addedApple.quantity).toBe('4');
      expect(addedApple.unit).toBe('pieces');
      expect(addedApple.location).toBe('fridge');
      expect(addedApple.expiresDate).toBe(expectedExpiry);

      const pantryList = await app!.request('/api/pantry?limit=200');
      const pantryRows = await pantryList.json();
      expect(pantryRows.some((r: any) => r.ingredientId === banana.id && r.quantity === '1000')).toBe(true);

      // 9. done is terminal: no second completion, no delete, no status flip,
      // and no item-level mutation that would desync the purchase record from
      // the pantry rows /complete just wrote.
      const again = await app!.request(`/api/shopping-lists/${listId}/complete`, json('POST', {}));
      expect(again.status).toBe(409);

      const reopen = await app!.request(`/api/shopping-lists/${listId}`, json('PATCH', { status: 'shopping' }));
      expect(reopen.status).toBe(409);

      const del = await app!.request(`/api/shopping-lists/${listId}`, { method: 'DELETE' });
      expect(del.status).toBe(409);

      const patchItem = await app!.request(
        `/api/shopping-lists/items/${appleItem.id}`,
        json('PATCH', { bought: false }),
      );
      expect(patchItem.status).toBe(409);

      const delItem = await app!.request(`/api/shopping-lists/items/${appleItem.id}`, {
        method: 'DELETE',
      });
      expect(delItem.status).toBe(409);

      const addItem = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: banana.id, quantityNeeded: 1, unit: 'g' }),
      );
      expect(addItem.status).toBe(409);
    } finally {
      await db!.delete(pantryItems).where(inArray(pantryItems.ingredientId, ingredientIds));
      if (listId) {
        await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, listId));
        await db!.delete(shoppingLists).where(eq(shoppingLists.id, listId));
      }
      if (entryId) {
        const delEntry = await app!.request(`/api/meal-plans/${entryId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delEntry.status);
      }
      if (recipeId) {
        const delRecipe = await app!.request(`/api/recipes/${recipeId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRecipe.status);
      }
    }
  });
});
