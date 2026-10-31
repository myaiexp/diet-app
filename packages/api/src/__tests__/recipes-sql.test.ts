// Real-Postgres smoke: recipe list, the write cycle, and import without AI configured

import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

describe.skipIf(!hasDb)('GET /api/recipes', () => {
  test('returns array', async () => {
    const res = await app!.request('/api/recipes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe.skipIf(!hasDb)('recipe write cycle', () => {
  test('ingredient from seed → POST → GET → PATCH → DELETE', async () => {
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let recipeId: string | undefined;
    try {
      const createRes = await app!.request('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Integration smoke recipe',
          servings: 2,
          ingredients: [{ ingredientId, quantity: 100, unit: 'g' }],
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      recipeId = created.id;
      expect(created.recipeIngredients).toHaveLength(1);

      const getRes = await app!.request(`/api/recipes/${recipeId}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).title).toBe('Integration smoke recipe');

      const scaleRes = await app!.request(`/api/recipes/${recipeId}?servings=2`);
      expect(scaleRes.status).toBe(200);
      const scaled = await scaleRes.json();
      expect(scaled.servings).toBe(2);
      expect(scaled.baseServings).toBe(2);
      expect(typeof scaled.recipeIngredients[0].quantity).toBe('string');
      expect(scaled.recipeIngredients[0].quantity).toBe('100');

      const patchRes = await app!.request(`/api/recipes/${recipeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated smoke recipe' }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).title).toBe('Updated smoke recipe');
    } finally {
      if (recipeId) {
        const delRes = await app!.request(`/api/recipes/${recipeId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRes.status);
      }
    }
  });
});

describe.skipIf(!hasDb)('POST /api/recipes/import', () => {
  // createApp(db) without ai config → import must 503 (no real AI keys in CI).
  test('returns 503 when AI is not configured', async () => {
    const res = await app!.request('/api/recipes/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1 cup flour\nBake bread' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'AI not configured' });
  });
});
