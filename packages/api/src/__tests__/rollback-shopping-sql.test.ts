// Real-Postgres proof that the shopping-list writes roll back as a unit
//
// Counterpart to the mock suites, whose transaction never rolls back (see
// rollback-recipes-sql.test.ts). Each case fails the route's last write after
// the earlier ones have executed, then asserts nothing of them survived.
import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import { mealPlanEntries, pantryItems, shoppingListItems, shoppingLists } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';
import { silenceInjectedFaults, withWriteFault } from './fault-db.js';
import {
  dropListsForWeek,
  dropRecipes,
  ingredientNamed,
  insertRecipe,
  json,
} from './rollback-fixtures.js';

const { db, hasDb } = useRealDb();
silenceInjectedFaults();

// Mondays of their own, clear of the weeks routes.test.ts uses.
const GENERATE_WEEK = '2027-03-01';
const COMPLETE_WEEK = '2027-03-08';
const DELETE_WEEK = '2027-03-15';

describe.skipIf(!hasDb)('shopping-list writes roll back as a unit', () => {
  test('generate: a failed prune leaves no half-built list for the week', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    await dropListsForWeek(db!, GENERATE_WEEK);
    const recipe = await insertRecipe(db!, `Rollback generate ${randomUUID()}`, [
      { ingredientId: carrot.id, quantity: 2, unit: 'pieces' },
    ]);
    try {
      await db!
        .insert(mealPlanEntries)
        .values({ date: '2027-03-03', slot: 'dinner', recipeId: recipe.id, servings: '1' });

      // New list row, then its items, then the prune — which fails.
      const fault = withWriteFault(db!, 'delete', shoppingListItems);
      const res = await createApp(fault.db).request(
        '/api/shopping-lists/generate',
        json('POST', { weekStarting: GENERATE_WEEK }),
      );
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual([
        'insert:shopping_lists',
        'insert:shopping_list_items',
        'delete:shopping_list_items',
      ]);

      const lists = await db!
        .select()
        .from(shoppingLists)
        .where(eq(shoppingLists.weekStarting, GENERATE_WEEK));
      expect(lists).toEqual([]);
    } finally {
      await dropListsForWeek(db!, GENERATE_WEEK);
      await dropRecipes(db!, [recipe.id]);
    }
  });

  test('complete: a failure after filing leaves the pantry untouched and the list open', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    await dropListsForWeek(db!, COMPLETE_WEEK);
    await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, carrot.id));
    const [list] = await db!.insert(shoppingLists).values({ weekStarting: COMPLETE_WEEK }).returning();
    try {
      // Bought produce with a fridge shelf life, so /complete files it.
      await db!.insert(shoppingListItems).values({
        listId: list!.id,
        ingredientId: carrot.id,
        quantityNeeded: '3',
        netToBuy: '3',
        category: carrot.category,
        unit: 'pieces',
        bought: true,
      });

      const fault = withWriteFault(db!, 'update', shoppingLists);
      const res = await createApp(fault.db).request(
        `/api/shopping-lists/${list!.id}/complete`,
        json('POST', {}),
      );
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual(['insert:pantry_items', 'update:shopping_lists']);

      expect(
        await db!.select().from(pantryItems).where(eq(pantryItems.ingredientId, carrot.id)),
      ).toEqual([]);
      const [row] = await db!.select().from(shoppingLists).where(eq(shoppingLists.id, list!.id));
      expect(row!.status).toBe('draft');
    } finally {
      await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, carrot.id));
      await dropListsForWeek(db!, COMPLETE_WEEK);
    }
  });

  test('DELETE: a failed list delete keeps its items', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    await dropListsForWeek(db!, DELETE_WEEK);
    const [list] = await db!.insert(shoppingLists).values({ weekStarting: DELETE_WEEK }).returning();
    try {
      await db!.insert(shoppingListItems).values({
        listId: list!.id,
        ingredientId: carrot.id,
        quantityNeeded: '1',
        netToBuy: '1',
        category: carrot.category,
        unit: 'pieces',
      });

      const fault = withWriteFault(db!, 'delete', shoppingLists);
      const res = await createApp(fault.db).request(`/api/shopping-lists/${list!.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual(['delete:shopping_list_items', 'delete:shopping_lists']);

      const items = await db!
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, list!.id));
      expect(items).toHaveLength(1);
    } finally {
      await dropListsForWeek(db!, DELETE_WEEK);
    }
  });
});
