// Real-Postgres proof that the cook and profile writes roll back as a unit
//
// Counterpart to the mock suites, whose transaction never rolls back (see
// rollback-recipes-sql.test.ts). Each case fails the route's last write after
// the earlier ones have executed, then asserts nothing of them survived.
import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import {
  mealPlanEntries,
  pantryItems,
  recipes,
  userDislikedIngredients,
  userProfile,
} from '@diet-app/db';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';
import { silenceInjectedFaults, withWriteFault } from './fault-db.js';
import { dropRecipes, ingredientNamed, insertRecipe, json } from './rollback-fixtures.js';

const { db, hasDb } = useRealDb();
silenceInjectedFaults();

describe.skipIf(!hasDb)('cook rolls back as a unit', () => {
  test('a failure after the deduction restores the pantry and timesCooked', async () => {
    const lentils = await ingredientNamed(db!, 'lentils');
    // FEFO must reach exactly the two lots below, not a leftover from a
    // crashed run — otherwise "unchanged" could pass without being tested.
    await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, lentils.id));
    const recipe = await insertRecipe(
      db!,
      `Rollback cook ${randomUUID()}`,
      [{ ingredientId: lentils.id, quantity: 500, unit: 'g' }],
      2,
    );
    try {
      const lot = (quantity: string, unit: string, expiresDate: string) =>
        db!
          .insert(pantryItems)
          .values({
            ingredientId: lentils.id,
            quantity,
            unit,
            location: 'pantry',
            addedDate: '2026-01-01',
            expiresDate,
          })
          .returning()
          .then((rows) => rows[0]!);
      // 500 g wanted: the early lot is used up (deleted), the late one drawn
      // down to 0.8 kg (updated) — both write paths of applyDeductions.
      const early = await lot('300', 'g', '2098-01-01');
      const late = await lot('1', 'kg', '2099-01-01');
      const [entry] = await db!
        .insert(mealPlanEntries)
        .values({ date: '2026-07-22', slot: 'dinner', recipeId: recipe.id, servings: '2' })
        .returning();

      const fault = withWriteFault(db!, 'update', mealPlanEntries);
      const res = await createApp(fault.db).request(`/api/meal-plans/${entry!.id}/cook`, json('POST'));
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual([
        'delete:pantry_items',
        'update:pantry_items',
        'update:recipes',
        'update:meal_plan_entries',
      ]);

      const lots = await db!
        .select({ id: pantryItems.id, quantity: pantryItems.quantity })
        .from(pantryItems)
        .where(inArray(pantryItems.id, [early.id, late.id]));
      expect(new Map(lots.map((l) => [l.id, l.quantity]))).toEqual(
        new Map([
          [early.id, '300'],
          [late.id, '1'],
        ]),
      );
      const [recipeRow] = await db!.select().from(recipes).where(eq(recipes.id, recipe.id));
      expect(recipeRow!.timesCooked).toBe(0);
      const [entryRow] = await db!
        .select()
        .from(mealPlanEntries)
        .where(eq(mealPlanEntries.id, entry!.id));
      expect(entryRow).toMatchObject({ status: 'planned', actualServings: null });
    } finally {
      await db!.delete(pantryItems).where(eq(pantryItems.ingredientId, lentils.id));
      await dropRecipes(db!, [recipe.id]);
    }
  });
});

describe.skipIf(!hasDb)('profile PATCH rolls back as a unit', () => {
  test('a failed dislike insert keeps the old name and dislikes', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    const leek = await ingredientNamed(db!, 'leek');
    const app = createApp(db!);
    const beforeRes = await app.request('/api/profile');
    expect(beforeRes.status).toBe(200);
    const before = (await beforeRes.json()) as {
      id: string;
      name: string;
      dislikedIngredientIds: string[];
    };

    try {
      const seeded = await app.request(
        '/api/profile',
        json('PATCH', { dislikedIngredientIds: [carrot.id] }),
      );
      expect(seeded.status).toBe(200);

      // Update the name, clear the dislikes, fail re-inserting them.
      const fault = withWriteFault(db!, 'insert', userDislikedIngredients);
      const res = await createApp(fault.db).request(
        '/api/profile',
        json('PATCH', { name: `Rollback ${randomUUID().slice(0, 8)}`, dislikedIngredientIds: [leek.id] }),
      );
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual([
        'update:user_profile',
        'delete:user_disliked_ingredients',
        'insert:user_disliked_ingredients',
      ]);

      const after = await (await app.request('/api/profile')).json();
      expect(after.name).toBe(before.name);
      expect(after.dislikedIngredientIds).toEqual([carrot.id]);
    } finally {
      // Direct writes: the profile is a singleton other suites read, and this
      // must restore it even when the PATCH validation would refuse the value.
      await db!.update(userProfile).set({ name: before.name }).where(eq(userProfile.id, before.id));
      await db!
        .delete(userDislikedIngredients)
        .where(eq(userDislikedIngredients.userId, before.id));
      if (before.dislikedIngredientIds.length > 0) {
        await db!.insert(userDislikedIngredients).values(
          before.dislikedIngredientIds.map((ingredientId) => ({ userId: before.id, ingredientId })),
        );
      }
    }
  });
});
