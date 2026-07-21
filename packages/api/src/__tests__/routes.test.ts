import { config } from 'dotenv';
config({ path: '../../.env' });

import { describe, test, expect, afterAll } from 'vitest';
import { createDb, cookFeedback } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

// Integration suite — exercises every route against a REAL Postgres instance
// (dietapp_test). It is GATED on TEST_DATABASE_URL: when that env var is absent
// (e.g. CI with no provisioned Postgres) the whole suite is skipped rather than
// crashing the process at import, so the mock-based unit suites in this dir
// (ingredients/pantry/recipes/meal-plans/shopping-lists.test.ts) still run and
// verify route logic Postgres-free. Deterministic 200-path and field-shape
// coverage lives in those unit suites; this suite is a real-schema smoke check.
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// SAFETY: never let the integration suite point at production. If a URL is set
// and it looks like the prod database — contains 'dietapp' without the '_test'
// suffix — hard-fail before opening any connection. (The error intentionally
// omits the URL, to avoid leaking any credentials embedded in a bad value.)
if (TEST_DB_URL && TEST_DB_URL.includes('dietapp') && !TEST_DB_URL.includes('_test')) {
  throw new Error(
    "Refusing to run tests: TEST_DATABASE_URL looks like the production database " +
      "(contains 'dietapp' but not '_test'). Point it at dietapp_test before running tests."
  );
}

const hasDb = Boolean(TEST_DB_URL);
const db = hasDb ? createDb(TEST_DB_URL!) : null;
const app = db ? createApp(db) : null;

// Write-path smokes mutate dietapp_test and clean up in try/finally so leftover
// rows do not accumulate across runs. The DB is isolated from prod (guarded
// above), so writes here are safe regardless.

afterAll(async () => {
  // Close the underlying pg pool so the test process exits cleanly.
  await db?.$client.end();
});

describe.skipIf(!hasDb)('GET /api/ingredients', () => {
  test('returns array', async () => {
    const res = await app!.request('/api/ingredients');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('?q=chicken returns filtered results', async () => {
    const res = await app!.request('/api/ingredients?q=chicken');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Each result should match chicken in name or aliases
    for (const item of body) {
      const nameMatch = item.name.toLowerCase().includes('chicken');
      const aliasMatch = (item.aliases ?? []).some((a: string) =>
        a.toLowerCase().includes('chicken')
      );
      expect(nameMatch || aliasMatch).toBe(true);
    }
  });

  test('?category=produce returns only produce', async () => {
    const res = await app!.request('/api/ingredients?category=produce');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(item.category).toBe('produce');
    }
  });

  // Finding #5: ?q + ?category exercises the and(...) combined SQL path that the
  // single-filter tests above never hit. Every row must satisfy BOTH filters.
  test('?q + ?category returns rows satisfying both filters', async () => {
    const res = await app!.request('/api/ingredients?q=chicken&category=protein');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(item.category).toBe('protein');
      const nameMatch = item.name.toLowerCase().includes('chicken');
      const aliasMatch = (item.aliases ?? []).some((a: string) =>
        a.toLowerCase().includes('chicken')
      );
      expect(nameMatch || aliasMatch).toBe(true);
    }
  });

  test('?limit caps the number of rows returned', async () => {
    const res = await app!.request('/api/ingredients?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(5);
  });

  test('/:id returns 404 for missing', async () => {
    const res = await app!.request('/api/ingredients/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

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

describe.skipIf(!hasDb)('GET /api/pantry', () => {
  test('returns array with status field', async () => {
    const res = await app!.request('/api/pantry');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const validStatuses = ['fresh', 'use_soon', 'use_today', 'expired'];
    for (const item of body) {
      expect(validStatuses).toContain(item.status);
    }
  });
});

describe.skipIf(!hasDb)('pantry write cycle', () => {
  test('resolve ingredient → POST → GET → PATCH → DELETE', async () => {
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let itemId: string | undefined;
    try {
      const createRes = await app!.request('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          quantity: 2,
          unit: 'pcs',
          location: 'fridge',
          expiresDate: '2099-12-31',
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      itemId = created.id;
      expect(created.status).toBeDefined();
      expect(created.quantity).toBe('2');

      const getRes = await app!.request(`/api/pantry/${itemId}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).id).toBe(itemId);

      const patchRes = await app!.request(`/api/pantry/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 5, unit: 'pcs' }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).quantity).toBe('5');
    } finally {
      if (itemId) {
        const delRes = await app!.request(`/api/pantry/${itemId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRes.status);
      }
    }
  });
});

describe.skipIf(!hasDb)('GET /api/profile', () => {
  test('returns user profile', async () => {
    const res = await app!.request('/api/profile');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(Array.isArray(body.dislikedIngredientIds)).toBe(true);
  });
});

describe.skipIf(!hasDb)('PATCH /api/profile', () => {
  test('updates householdSize on real DB and restores', async () => {
    const getRes = await app!.request('/api/profile');
    expect(getRes.status).toBe(200);
    const before = await getRes.json();
    const originalSize = before.householdSize as number;
    const nextSize = originalSize === 1 ? 2 : 1;

    try {
      const patchRes = await app!.request('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdSize: nextSize }),
      });
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.householdSize).toBe(nextSize);
      expect(Array.isArray(patched.dislikedIngredientIds)).toBe(true);
    } finally {
      const restore = await app!.request('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdSize: originalSize }),
      });
      expect(restore.status).toBe(200);
      expect((await restore.json()).householdSize).toBe(originalSize);
    }
  });
});

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
      });
      expect(cookRes.status).toBe(200);
      const cookBody = await cookRes.json();
      expect(cookBody.entry.status).toBe('cooked');
      expect(cookBody.shortfalls).toEqual([]);

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
      });
      expect(reCook.status).toBe(409);
      expect(await reCook.json()).toEqual({
        error: 'Meal plan entry already cooked',
      });

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
