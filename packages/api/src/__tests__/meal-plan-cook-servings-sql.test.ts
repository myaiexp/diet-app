// Real-Postgres smoke: a cook servings override scales the deduction and keeps the planned figure

import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

describe.skipIf(!hasDb)('cook flow', () => {
  test('a cook servings override scales the deduction and leaves planned servings alone', async () => {
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    const ingredientId = (await ingredientsRes.json())[0].id as string;

    let recipeId: string | undefined;
    let pantryId: string | undefined;
    let entryId: string | undefined;

    try {
      // Recipe serves 2 on a 500 g line; entry is planned for 2; cook 4.
      const recipeRes = await app!.request('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Cook-override smoke recipe',
          servings: 2,
          ingredients: [{ ingredientId, quantity: 500, unit: 'g' }],
        }),
      });
      expect(recipeRes.status).toBe(201);
      recipeId = (await recipeRes.json()).id as string;

      const pantryRes = await app!.request('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          quantity: 3,
          unit: 'kg',
          location: 'pantry',
          expiresDate: '2099-12-31',
        }),
      });
      expect(pantryRes.status).toBe(201);
      pantryId = (await pantryRes.json()).id as string;

      const entryRes = await app!.request('/api/meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-07-21',
          slot: 'lunch',
          recipeId,
          servings: 2,
        }),
      });
      expect(entryRes.status).toBe(201);
      entryId = (await entryRes.json()).id as string;

      const cookRes = await app!.request(`/api/meal-plans/${entryId}/cook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servings: 4 }),
      });
      expect(cookRes.status).toBe(200);
      const cooked = await cookRes.json();
      // scale 4/2 = 2 → 1000 g off a 3 kg lot
      expect(cooked.deductions[0].requested).toBe(1000);
      expect(cooked.entry.actualServings).toBe('4');
      expect(cooked.entry.servings).toBe('2');

      const pantryGet = await app!.request(`/api/pantry/${pantryId}`);
      expect((await pantryGet.json()).quantity).toBe('2');

      // Re-read: the planned/actual split is what Postgres actually stored, not
      // just what the cook response echoed back.
      const week = await app!.request('/api/meal-plans/week/2026-07-21');
      const stored = (await week.json()).find(
        (e: { id: string }) => e.id === entryId,
      );
      expect(stored).toMatchObject({ servings: '2', actualServings: '4' });
    } finally {
      if (entryId) {
        const delEntry = await app!.request(`/api/meal-plans/${entryId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delEntry.status);
      }
      if (recipeId) {
        const delRecipe = await app!.request(`/api/recipes/${recipeId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRecipe.status);
      }
      if (pantryId) {
        const delPantry = await app!.request(`/api/pantry/${pantryId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delPantry.status);
      }
    }
  });
});
