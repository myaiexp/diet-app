// Mock-based route tests for DELETE /recipes/:id and its 404/409 mappings.

import { describe, test, expect } from 'vitest';
import { recipes } from '@diet-app/db';
import { recipesRoutes } from '../routes/recipes.js';
import { RECIPE_ID, fkViolationOn, makeWriteMock } from './recipes-test-helpers.js';

describe('recipesRoutes', () => {
  test('DELETE /:id 204 when free', async () => {
    const { db } = makeWriteMock({
      findFirst: { id: RECIPE_ID },
      mealPlanRefs: [],
      childRecipes: [],
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  test('DELETE /:id 409 when meal plan references', async () => {
    const { db } = makeWriteMock({
      findFirst: { id: RECIPE_ID },
      mealPlanRefs: [{ id: 'mp-1' }],
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Recipe is referenced by meal plan entries',
    });
  });

  test('DELETE /:id 409 when child fork exists', async () => {
    const { db } = makeWriteMock({
      findFirst: { id: RECIPE_ID },
      mealPlanRefs: [],
      childRecipes: [{ id: 'child-1' }],
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Recipe has forked child recipes' });
  });

  test('DELETE /:id 404 when missing', async () => {
    const { db } = makeWriteMock({ findFirst: null });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('DELETE /:id maps an FK violation (23503) to the same 409 as the pre-check', async () => {
    // A meal plan entry claimed the recipe after both pre-checks passed; the
    // race must land on the pre-check's message, not a 500.
    const { db, writes } = makeWriteMock({
      findFirst: { id: RECIPE_ID },
      mealPlanRefs: [],
      childRecipes: [],
      throwOnWrite: fkViolationOn(recipes),
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Recipe is referenced by meal plan entries',
    });
    // Lines deleted first, then the recipe delete is the statement that failed.
    expect(writes.map((w) => w.table)).toEqual(['recipe_ingredients', 'recipes']);
  });
});
