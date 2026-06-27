// Mock-based route tests for recipesRoutes — deterministic, Postgres-free.
// Covers the :id 200 path (including the recipeIngredients relation shape), the
// 404 path, and the GET / list-filter wiring for ?tags=/?cuisine= (which the
// integration suite cannot exercise — nothing is seeded). The filter tests
// render the WHERE clause the handler builds (via PgDialect) to prove each
// query param is actually applied; buildTagsCondition's own SQL shape is unit-
// tested in recipe-filters.test.ts.

import { describe, test, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { recipesRoutes } from '../routes/recipes.js';
import { makeSelectMock } from './select-mock.js';

const dialect = new PgDialect();

const RECIPE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const RECIPE_WITH_RELATIONS = {
  id: RECIPE_ID,
  title: 'Roast chicken',
  sourceType: 'manual',
  recipeIngredients: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      quantity: '500',
      unit: 'g',
      ingredient: { id: '22222222-2222-2222-2222-222222222222', name: 'Chicken' },
    },
  ],
};

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
    const q = dialect.sqlToQuery(calls.where as any);
    expect(q.params).toContain('italian');
  });

  test('GET /?tags=pasta,italian applies a two-element array filter', async () => {
    const { db, calls } = makeSelectMock([]);
    const res = await recipesRoutes(db).request('/?tags=pasta,italian');
    expect(res.status).toBe(200);
    const q = dialect.sqlToQuery(calls.where as any);
    expect(q.sql).toContain('@> ARRAY[$1, $2]::text[]');
    expect(q.params).toEqual(['pasta', 'italian']);
  });

  test('GET /?tags=&cuisine= combines both filters with AND', async () => {
    const { db, calls } = makeSelectMock([]);
    const res = await recipesRoutes(db).request('/?cuisine=italian&tags=pasta');
    expect(res.status).toBe(200);
    const q = dialect.sqlToQuery(calls.where as any);
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
});
