// Recipes routes: list filters and ordering, GET /:id reads and ?servings=
// The GET / ?tags=/?cuisine= filter wiring lives here because the integration suite
// cannot exercise it (nothing is seeded). The filter tests render the WHERE clause the
// handler builds (renderWhere) to prove each query param is actually applied;
// buildTagsCondition's own SQL shape is unit-tested in recipe-filters.test.ts.

import { describe, test, expect } from 'vitest';
import { asc, desc } from 'drizzle-orm';
import { recipes } from '@diet-app/db';
import { recipesRoutes } from '../routes/recipes.js';
import { makeSelectMock } from './db-mock.js';
import { renderWhere } from './drizzle-introspect.js';
import { RECIPE_ID, RECIPE_WITH_RELATIONS } from './recipes-test-helpers.js';

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

  // Finding #5450: paging a LIMIT/OFFSET query with no ORDER BY can repeat and
  // skip rows. createdAt alone is not a total order (a bulk import stamps many
  // rows in one tick), hence the id tie-break.
  test('GET / orders newest-first with an id tie-break before paging', async () => {
    const { db, calls } = makeSelectMock([]);
    await recipesRoutes(db).request('/');
    expect(calls.orderBy).toEqual([desc(recipes.createdAt), asc(recipes.id)]);
  });

  test('GET / orders on the filtered path too', async () => {
    const { db, calls } = makeSelectMock([]);
    await recipesRoutes(db).request('/?cuisine=italian&tags=pasta');
    expect(calls.orderBy).toEqual([desc(recipes.createdAt), asc(recipes.id)]);
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

  test.each(['13', '1e9', '0.5'])('GET /:id?servings=%s returns 400', async (raw) => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}?servings=${raw}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.formErrors).toContain('Invalid servings query');
  });

  test('GET /:id?servings=12 still scales', async () => {
    const mockDb = { query: { recipes: { findFirst: async () => RECIPE_WITH_RELATIONS } } } as any;
    const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}?servings=12`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servings).toBe(12);
    expect(body.baseServings).toBe(2);
    expect(body.recipeIngredients[0].quantity).toBe('3000');
  });

  // Distinct from invalid query servings=0: a stored recipe with a non-positive
  // base cannot scale, and the route maps that to a different 400.
  test('GET /:id?servings=4 returns 400 Invalid servings scale when stored servings is 0 or NaN', async () => {
    for (const servings of [0, NaN]) {
      const mockDb = {
        query: {
          recipes: { findFirst: async () => ({ ...RECIPE_WITH_RELATIONS, servings }) },
        },
      } as any;
      const res = await recipesRoutes(mockDb).request(`/${RECIPE_ID}?servings=4`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid servings scale' });
    }
  });
});
