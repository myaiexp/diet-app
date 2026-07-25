// Mock-based route tests for recipesRoutes — deterministic, Postgres-free.
// Covers the :id 200 path (including the recipeIngredients relation shape), the
// 404 path, and the GET / list-filter wiring for ?tags=/?cuisine= (which the
// integration suite cannot exercise — nothing is seeded). The filter tests
// render the WHERE clause the handler builds (renderWhere) to prove each query
// param is actually applied; buildTagsCondition's own SQL shape is unit-tested
// in recipe-filters.test.ts.

import { describe, test, expect, vi } from 'vitest';
import { mealPlanEntries, recipes } from '@diet-app/db';
import { recipesRoutes } from '../routes/recipes.js';
import { makeDbMock, makeSelectMock, type DbMock } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { renderWhere } from './drizzle-introspect.js';

const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const INGREDIENT_ID = '11111111-1111-4111-8111-111111111111';

const RECIPE_WITH_RELATIONS = {
  id: RECIPE_ID,
  title: 'Roast chicken',
  sourceType: 'manual',
  servings: 2,
  recipeIngredients: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      quantity: '500',
      unit: 'g',
      ingredient: { id: INGREDIENT_ID, name: 'Chicken' },
    },
  ],
};

const VALID_CREATE = {
  title: 'Roast chicken',
  ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 500, unit: 'g' }],
};

type WriteMockOpts = {
  findFirst?: unknown | null | (() => unknown);
  mealPlanRefs?: unknown[];
  childRecipes?: unknown[];
  throwOnTransaction?: unknown;
};

function makeWriteMock(opts: WriteMockOpts = {}) {
  let mock: DbMock;

  const resolveFind = () => {
    if (typeof opts.findFirst === 'function') return (opts.findFirst as () => unknown)();
    if (opts.findFirst !== undefined) return opts.findFirst;
    // Pre-write reads are existence checks (the handler only needs an id); the
    // reload after a write is what the response is built from, so it carries
    // the full relation shape. Keyed on whether a write has landed rather than
    // on call count, so an extra pre-check can't shift the fixtures.
    return mock.writes.length === 0
      ? { id: RECIPE_ID, title: 'Roast chicken' }
      : RECIPE_WITH_RELATIONS;
  };

  mock = makeDbMock({
    insertRows: () => [{ id: RECIPE_ID, title: VALID_CREATE.title, sourceType: 'manual' }],
    // DELETE pre-checks meal-plan references, then forked child recipes.
    select: makeSelectRouter([
      [mealPlanEntries, opts.mealPlanRefs ?? []],
      [recipes, opts.childRecipes ?? []],
    ]).select,
    query: {
      recipes: {
        findFirst: vi.fn(async () => resolveFind()),
      },
    },
    beforeTransaction: () => {
      if (opts.throwOnTransaction) throw opts.throwOnTransaction;
    },
  });
  return mock;
}

describe('recipesRoutes', () => {
  test('GET / returns an array', async () => {
    const { db } = makeSelectMock([RECIPE_WITH_RELATIONS]);
    const app = recipesRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('GET / with no filters builds no WHERE clause', async () => {
    const { db, calls } = makeSelectMock([]);
    await recipesRoutes(db).request('/');
    expect(calls.where).toBeUndefined();
  });

  test('GET /?cuisine=italian filters on cuisineType', async () => {
    const { db, calls } = makeSelectMock([]);
    const res = await recipesRoutes(db).request('/?cuisine=italian');
    expect(res.status).toBe(200);
    const q = renderWhere(calls.where);
    expect(q.params).toContain('italian');
  });

  test('GET /?tags=pasta,italian applies a two-element array filter', async () => {
    const { db, calls } = makeSelectMock([]);
    const res = await recipesRoutes(db).request('/?tags=pasta,italian');
    expect(res.status).toBe(200);
    const q = renderWhere(calls.where);
    expect(q.sql).toContain('@> ARRAY[$1, $2]::text[]');
    expect(q.params).toEqual(['pasta', 'italian']);
  });

  test('GET /?tags=&cuisine= combines both filters with AND', async () => {
    const { db, calls } = makeSelectMock([]);
    const res = await recipesRoutes(db).request('/?cuisine=italian&tags=pasta');
    expect(res.status).toBe(200);
    const q = renderWhere(calls.where);
    // Both filters present: cuisine equality + tag array containment, ANDed.
    expect(q.sql).toContain('and');
    expect(q.sql).toContain('@> ARRAY[$2]::text[]');
    expect(q.params).toEqual(['italian', 'pasta']);
  });

  test('GET /:id rejects a malformed id with 400 before touching the DB', async () => {
    const app = recipesRoutes({} as any);
    const res = await app.request('/not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  test('GET /:id returns 200 with the recipeIngredients relation when found', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const app = recipesRoutes(mockDb);
    const res = await app.request(`/${RECIPE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(RECIPE_ID);
    expect(Array.isArray(body.recipeIngredients)).toBe(true);
    expect(body.recipeIngredients[0].ingredient.name).toBe('Chicken');
  });

  test('GET /:id returns 404 with error body when missing', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => undefined } } } as any;
    const app = recipesRoutes(mockDb);
    const res = await app.request(`/${RECIPE_ID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('GET /:id without servings omits baseServings', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baseServings).toBeUndefined();
    expect(body.recipeIngredients[0].quantity).toBe('500');
  });

  test('GET /:id?servings=4 scales lines and sets baseServings', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}?servings=4`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servings).toBe(4);
    expect(body.baseServings).toBe(2);
    expect(body.recipeIngredients[0].quantity).toBe('1000');
  });

  test('GET /:id?servings=0 returns 400', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}?servings=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.formErrors).toContain('Invalid servings query');
  });

  test('GET /:id?servings=abc returns 400', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}?servings=abc`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('POST / creates recipe and returns recipeIngredients', async () => {
    const { db } = makeWriteMock({
      findFirst: () => RECIPE_WITH_RELATIONS,
    });
    const res = await recipesRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CREATE),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.recipeIngredients).toHaveLength(1);
    expect(body.recipeIngredients[0].ingredient.name).toBe('Chicken');
  });

  test('POST / rejects empty ingredients array', async () => {
    const { db } = makeWriteMock();
    const res = await recipesRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Empty', ingredients: [] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('POST / rejects missing title', async () => {
    const { db } = makeWriteMock();
    const res = await recipesRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'g' }],
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('PATCH /:id 404 when missing', async () => {
    const { db } = makeWriteMock({ findFirst: null });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCH /:id rejects empty body with 400', async () => {
    const { db } = makeWriteMock();
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('PATCH /:id header-only leaves ingredients when ingredients key omitted', async () => {
    const { db, deletes, updates } = makeWriteMock({
      findFirst: () => RECIPE_WITH_RELATIONS,
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title' }),
    });
    expect(res.status).toBe(200);
    expect(updates.some((u) => (u as any).title === 'Updated title')).toBe(true);
    // No ingredient replace → no deletes inside the transaction for lines.
    expect(deletes).toHaveLength(0);
  });

  test('PATCH /:id with ingredients replaces set', async () => {
    const { db, deletes, inserts } = makeWriteMock({
      findFirst: () => RECIPE_WITH_RELATIONS,
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(deletes.length).toBeGreaterThan(0);
    expect(inserts.length).toBeGreaterThan(0);
  });

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
});
