// Real-Postgres smoke: week read, and a cook that deducts stock and increments timesCooked

import { describe, test, expect } from 'vitest';
import { cookFeedback } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

describe.skipIf(!hasDb)('GET /api/meal-plans', () => {
  // Real-schema contract check: every returned entry has date/slot/status.
  // Deterministic populated-week coverage is in meal-plans.test.ts.
  test('/week/:date returns week entries with the expected shape', async () => {
    const res = await app!.request('/api/meal-plans/week/2026-03-05');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const entry of body) {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('slot');
      expect(entry).toHaveProperty('status');
    }
  });
});

describe.skipIf(!hasDb)('cook flow', () => {
  test('cooking an entry deducts pantry stock and increments timesCooked', async () => {
    // 1. Real ingredient id from seed (never hardcode UUIDs)
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let recipeId: string | undefined;
    let pantryId: string | undefined;
    let entryId: string | undefined;

    try {
      // 2. Recipe: servings 2, one line 500 g
      const recipeRes = await app!.request('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Cook-flow smoke recipe',
          servings: 2,
          ingredients: [{ ingredientId, quantity: 500, unit: 'g' }],
        }),
      });
      expect(recipeRes.status).toBe(201);
      recipeId = (await recipeRes.json()).id as string;

      // 3. Pantry: 1 kg of same ingredient (explicit expiresDate)
      const pantryRes = await app!.request('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          quantity: 1,
          unit: 'kg',
          location: 'pantry',
          expiresDate: '2099-12-31',
        }),
      });
      expect(pantryRes.status).toBe(201);
      pantryId = (await pantryRes.json()).id as string;

      // 4. Meal plan entry: servings 2, dinner
      const entryRes = await app!.request('/api/meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-07-20',
          slot: 'dinner',
          recipeId,
          servings: 2,
        }),
      });
      expect(entryRes.status).toBe(201);
      entryId = (await entryRes.json()).id as string;

      // 5. Cook → 200, cooked, no shortfalls
      const cookRes = await app!.request(`/api/meal-plans/${entryId}/cook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(cookRes.status).toBe(200);
      const cookBody = await cookRes.json();
      expect(cookBody.entry.status).toBe('cooked');
      expect(cookBody.shortfalls).toEqual([]);
      // No body → cooked as planned, and the numeric column round-trips as a
      // string like every other numeric in this API.
      expect(cookBody.entry.servings).toBe('2');
      expect(cookBody.entry.actualServings).toBe('2');

      // 6. Pantry quantity 1 kg → 0.5 kg (scale = 2/2 = 1; 500 g from 1 kg)
      const pantryGet = await app!.request(`/api/pantry/${pantryId}`);
      expect(pantryGet.status).toBe(200);
      expect((await pantryGet.json()).quantity).toBe('0.5');

      // 7. timesCooked === 1
      const recipeGet = await app!.request(`/api/recipes/${recipeId}`);
      expect(recipeGet.status).toBe(200);
      expect((await recipeGet.json()).timesCooked).toBe(1);

      // 8. Second cook → 409
      const reCook = await app!.request(`/api/meal-plans/${entryId}/cook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(reCook.status).toBe(409);
      expect(await reCook.json()).toEqual({
        error: 'Meal plan entry already cooked',
      });

      // 8b. PATCH cannot rewrite the inputs the deduction was computed from.
      // Each rejection must leave the pantry exactly where the cook left it.
      for (const patch of [
        { servings: 4 },
        { substituteRecipeId: recipeId },
        { servings: 4, notes: 'should not land' },
      ]) {
        const bad = await app!.request(`/api/meal-plans/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        expect(bad.status, `expected 409 for ${JSON.stringify(patch)}`).toBe(409);
        expect(await bad.json()).toEqual({
          error: 'Cooked meal plan entry recipe and servings are immutable',
        });
      }
      const pantryAfterPatch = await app!.request(`/api/pantry/${pantryId}`);
      expect((await pantryAfterPatch.json()).quantity).toBe('0.5');

      // 8c. …but the non-cook fields, and an unchanged resend, still go through.
      const okPatch = await app!.request(`/api/meal-plans/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servings: 2, recipeId, notes: 'a bit salty' }),
      });
      expect(okPatch.status).toBe(200);
      const patched = await okPatch.json();
      expect(patched.notes).toBe('a bit salty');
      expect(patched.status).toBe('cooked');

      // 9. Feedback create + get
      const fbRes = await app!.request(`/api/meal-plans/${entryId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: 'thumbs_up',
          effortCheck: 'felt_right',
          makeAgain: 'yes',
          usedAsIs: true,
        }),
      });
      expect(fbRes.status).toBe(201);
      const fbGet = await app!.request(`/api/meal-plans/${entryId}/feedback`);
      expect(fbGet.status).toBe(200);
      expect((await fbGet.json()).rating).toBe('thumbs_up');

      // 9b. The usedAsIs/changesNote pair round-trips through Postgres: the row
      // that comes back has to be the pair the handler validated, including on
      // a patch that names neither field.
      const patchFeedback = async (body: unknown) =>
        app!.request(`/api/meal-plans/${entryId}/feedback`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

      const withNote = await patchFeedback({ usedAsIs: false, changesNote: 'less salt' });
      expect(withNote.status).toBe(200);
      expect(await withNote.json()).toMatchObject({
        usedAsIs: false,
        changesNote: 'less salt',
      });

      // Only the rating changes — the stored pair must survive untouched.
      const ratingOnly = await patchFeedback({ rating: 'thumbs_down' });
      expect(ratingOnly.status).toBe(200);
      expect(await ratingOnly.json()).toMatchObject({
        rating: 'thumbs_down',
        usedAsIs: false,
        changesNote: 'less salt',
      });

      // Flipping back to "cooked as written" drops the note it no longer allows.
      const cleared = await patchFeedback({ usedAsIs: true });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({ usedAsIs: true, changesNote: null });

      // A note sent alongside usedAsIs:true is a contradiction, not an auto-clear.
      const contradiction = await patchFeedback({ usedAsIs: true, changesNote: 'x' });
      expect(contradiction.status).toBe(400);
      const stillCleared = await app!.request(`/api/meal-plans/${entryId}/feedback`);
      expect(await stillCleared.json()).toMatchObject({
        usedAsIs: true,
        changesNote: null,
      });
    } finally {
      // feedback has no DELETE route — remove via db before entry delete
      if (entryId && db) {
        await db.delete(cookFeedback).where(eq(cookFeedback.mealPlanEntryId, entryId));
        const delEntry = await app!.request(`/api/meal-plans/${entryId}`, {
          method: 'DELETE',
        });
        expect([204, 404]).toContain(delEntry.status);
      }
      if (recipeId) {
        const delRecipe = await app!.request(`/api/recipes/${recipeId}`, {
          method: 'DELETE',
        });
        expect([204, 404]).toContain(delRecipe.status);
      }
      if (pantryId) {
        const delPantry = await app!.request(`/api/pantry/${pantryId}`, {
          method: 'DELETE',
        });
        expect([204, 404]).toContain(delPantry.status);
      }
    }
  });
});
