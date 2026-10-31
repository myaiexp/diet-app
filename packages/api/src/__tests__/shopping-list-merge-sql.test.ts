// Real-Postgres smoke: regeneration against a manual row, and the unique indexes the merge rests on

import { describe, test, expect } from 'vitest';
import { shoppingLists, shoppingListItems, pantryItems } from '@diet-app/db';
import { eq } from 'drizzle-orm';
// Asserted through the production predicate rather than a literal error shape:
// Drizzle wraps driver errors, and what matters is that the routes' own
// mapping recognizes the violation — not which wrapper this version uses.
import { isUniqueViolation } from '../pg-errors.js';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';
import { shoppingSqlHelpers } from './shopping-sql-helpers.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;
const { json, findIngredient, itemFor } = shoppingSqlHelpers(app);

describe.skipIf(!hasDb)('shopping list merge', () => {
  // The round trip in shopping-list-flow-sql hand-adds banana, an ingredient the plan never
  // needs, so it only proves the prune is source-scoped. This case collides
  // on the unique index: the user types a banana amount, the plan then
  // needs banana too, and regeneration must leave the manual numbers alone.
  test('regeneration does not rewrite a colliding manual row', async () => {
    const banana = await findIngredient('banana');
    const COLLIDE_MONDAY = '2026-10-05';
    const COLLIDE_MID = '2026-10-08';

    let recipeId: string | undefined;
    let entryId: string | undefined;
    let listId: string | undefined;

    try {
      await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, banana.id));
      const stale = await db!
        .select({ id: shoppingLists.id })
        .from(shoppingLists)
        .where(eq(shoppingLists.weekStarting, COLLIDE_MONDAY));
      for (const row of stale) {
        await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, row.id));
        await db!.delete(shoppingLists).where(eq(shoppingLists.id, row.id));
      }

      // Empty generate so the list exists to hand-add into.
      const genRes = await app!.request(
        '/api/shopping-lists/generate',
        json('POST', { weekStarting: COLLIDE_MONDAY }),
      );
      expect(genRes.status).toBe(200);
      listId = ((await genRes.json()) as { list: { id: string } }).list.id;

      const manual = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: banana.id, quantityNeeded: 1, unit: 'kg' }),
      );
      expect(manual.status).toBe(201);
      const manualItem = (await manual.json()) as {
        id: string;
        quantityNeeded: string;
        quantityInPantry: string;
        netToBuy: string;
        source: string;
        unit: string;
      };
      expect(manualItem.unit).toBe('g');
      expect(manualItem.quantityNeeded).toBe('1000');
      expect(manualItem.quantityInPantry).toBe('0');
      expect(manualItem.netToBuy).toBe('1000');
      expect(manualItem.source).toBe('manual');

      // Pantry stock the aggregator would write onto quantityInPantry if the
      // upsert were allowed to touch this row — 0-vs-0 wouldn't catch it.
      const pantryRes = await app!.request(
        '/api/pantry',
        json('POST', {
          ingredientId: banana.id,
          quantity: 50,
          unit: 'g',
          location: 'fridge',
          expiresDate: '2099-12-31',
        }),
      );
      expect(pantryRes.status).toBe(201);

      const recipeRes = await app!.request(
        '/api/recipes',
        json('POST', {
          title: 'Manual-row collision recipe',
          servings: 1,
          ingredients: [{ ingredientId: banana.id, quantity: 200, unit: 'g' }],
        }),
      );
      expect(recipeRes.status).toBe(201);
      recipeId = ((await recipeRes.json()) as { id: string }).id;

      const entryRes = await app!.request(
        '/api/meal-plans',
        json('POST', { date: COLLIDE_MID, slot: 'dinner', recipeId, servings: 1 }),
      );
      expect(entryRes.status).toBe(201);
      entryId = ((await entryRes.json()) as { id: string }).id;

      const regen = await app!.request(
        '/api/shopping-lists/generate',
        json('POST', { weekStarting: COLLIDE_MONDAY }),
      );
      expect(regen.status).toBe(200);
      const regenerated = (await regen.json()) as { items: Array<Record<string, unknown>> };
      const bananaRows = regenerated.items.filter(
        (i) => i.ingredientId === banana.id && i.unit === 'g',
      );
      expect(bananaRows).toHaveLength(1);
      const after = bananaRows[0]!;
      expect(after.id).toBe(manualItem.id);
      expect(after.source).toBe('manual');
      expect(after.quantityNeeded, 'user-typed amount must survive').toBe('1000');
      expect(after.quantityInPantry, 'manual rows are never netted').toBe('0');
      expect(after.netToBuy).toBe('1000');
    } finally {
      await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, banana.id));
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

  // The two constraints the merge model rests on. A mock cannot prove an index
  // exists — only Postgres refusing the second row can.
  test('enforces the (list_id, ingredient_id, unit) unique index at the DB level', async () => {
    const apple = await findIngredient('apple');
    const [list] = await db!.insert(shoppingLists).values({ weekStarting: '2026-09-21' }).returning();
    try {
      const row = {
        listId: list!.id,
        ingredientId: apple.id,
        quantityNeeded: '1',
        netToBuy: '1',
        category: apple.category,
        unit: 'pieces',
      };
      await db!.insert(shoppingListItems).values(row);
      await expect(db!.insert(shoppingListItems).values(row)).rejects.toSatisfy(isUniqueViolation);
    } finally {
      await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, list!.id));
      await db!.delete(shoppingLists).where(eq(shoppingLists.id, list!.id));
    }
  });

  test('enforces the week_starting unique index at the DB level', async () => {
    const [list] = await db!.insert(shoppingLists).values({ weekStarting: '2026-09-28' }).returning();
    try {
      await expect(
        db!.insert(shoppingLists).values({ weekStarting: '2026-09-28' }),
      ).rejects.toSatisfy(isUniqueViolation);
    } finally {
      await db!.delete(shoppingLists).where(eq(shoppingLists.id, list!.id));
    }
  });
});
