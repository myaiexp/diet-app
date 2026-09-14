// Mock-based route tests for recipesRoutes — deterministic, Postgres-free.
// Covers the :id 200 path (including the recipeIngredients relation shape), the
// 404 path, and the GET / list-filter wiring for ?tags=/?cuisine= (which the
// integration suite cannot exercise — nothing is seeded). The filter tests
// render the WHERE clause the handler builds (renderWhere) to prove each query
// param is actually applied; buildTagsCondition's own SQL shape is unit-tested
// in recipe-filters.test.ts.

import { describe, test, expect, vi } from 'vitest';
import { asc, desc, type Table } from 'drizzle-orm';
import { mealPlanEntries, recipeIngredients, recipes } from '@diet-app/db';
import { recipesRoutes } from '../routes/recipes.js';
import {
  makeDbMock,
  makeSelectMock,
  pgError,
  type DbMock,
  type ThrowOnWrite,
} from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { renderWhere, tableNameOf } from './drizzle-introspect.js';

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
  /** Fail a matching write with a driver-shaped error (see db-mock). */
  throwOnWrite?: ThrowOnWrite;
};

/**
 * Fail the write that touches `table` with a Postgres FK violation. Every
 * recipe write path spans two tables inside one transaction, so which one the
 * database rejects is the whole point: an unknown ingredientId breaks the
 * recipe_ingredients insert, a still-referenced recipe breaks the recipes delete.
 */
const fkViolationOn =
  (table: Table): ThrowOnWrite =>
  (record) =>
    record.table === tableNameOf(table) ? pgError('23503') : undefined;

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
    throwOnWrite: opts.throwOnWrite,
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

  test('POST / maps an unknown ingredientId (23503) to 400 Invalid reference', async () => {
    // Nothing pre-checks the ingredient ids — the FK is the only guard, so this
    // branch is what stands between a bad id and an unhandled 500.
    const { db, writes } = makeWriteMock({
      throwOnWrite: fkViolationOn(recipeIngredients),
    });
    const res = await recipesRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CREATE),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
    // Statement order only: the recipes insert is issued first, the lines insert
    // is what fails. The mock cannot roll back, so it says nothing about whether
    // the recipes row survives — in Postgres it does not, which
    // rollback-recipes-sql.test.ts asserts.
    expect(writes.map((w) => w.table)).toEqual(['recipes', 'recipe_ingredients']);
  });

  test('POST / lets a non-FK database error escape as a 500', async () => {
    const { db } = makeWriteMock({
      throwOnWrite: () => pgError('40001'), // serialization failure
    });
    const res = await recipesRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CREATE),
    });
    expect(res.status).toBe(500);
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

  test('PATCH /:id with ingredients: [] returns 400 and does not wipe lines', async () => {
    const { db, deletes, inserts } = makeWriteMock({
      findFirst: () => RECIPE_WITH_RELATIONS,
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: [] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(deletes).toHaveLength(0);
    expect(inserts).toHaveLength(0);
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

  test('PATCH /:id maps an unknown ingredientId (23503) to 400 Invalid reference', async () => {
    const { db } = makeWriteMock({
      findFirst: () => RECIPE_WITH_RELATIONS,
      throwOnWrite: fkViolationOn(recipeIngredients),
    });
    const res = await recipesRoutes(db).request(`/${RECIPE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg' }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
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

// --- POST /:id/fork (idea #2660) --------------------------------------------

const FORK_ID = '99999999-9999-4999-8999-999999999999';

/** A source recipe carrying every copyable column plus two ingredient lines. */
const SOURCE_RECIPE = {
  id: RECIPE_ID,
  title: 'Roast chicken',
  sourceType: 'imported',
  sourceUrl: 'https://example.com/roast',
  parentRecipeId: null,
  steps: [{ instruction: 'Roast it', timerMinutes: 60 }],
  prepTime: 15,
  totalTime: 75,
  servings: 4,
  effortScore: 3,
  tags: ['dinner', 'chicken'],
  cuisineType: 'nordic',
  // Personal history — must NOT ride along onto the copy.
  userRating: 5,
  timesCooked: 7,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  recipeIngredients: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      recipeId: RECIPE_ID,
      ingredientId: INGREDIENT_ID,
      quantity: '500',
      unit: 'g',
      optional: false,
      notes: 'free range',
      ingredient: { id: INGREDIENT_ID, name: 'Chicken' },
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      recipeId: RECIPE_ID,
      ingredientId: '44444444-4444-4444-8444-444444444444',
      quantity: '2',
      unit: 'tsp',
      optional: true,
      notes: null,
      ingredient: { id: '44444444-4444-4444-8444-444444444444', name: 'Salt' },
    },
  ],
};

/**
 * findFirst answers the source before any write and the new fork after — keyed
 * on writes, not call count, so an extra read can't shift the fixtures.
 */
function makeForkMock(source: unknown = SOURCE_RECIPE) {
  let mock: DbMock;
  mock = makeDbMock({
    insertRows: (_recorded, record) =>
      record.table === tableNameOf(recipes)
        ? [{ ...(record.values as object), id: FORK_ID }]
        : [],
    query: {
      recipes: {
        findFirst: vi.fn(async () =>
          mock.writes.length === 0 ? source : { id: FORK_ID, recipeIngredients: [] },
        ),
      },
    },
  });
  return mock;
}

const forkRequest = (id: string, body?: unknown) =>
  recipesRoutes(makeForkMock().db).request(`/${id}/fork`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('POST /recipes/:id/fork', () => {
  test('rejects a malformed id with 400 before touching the DB', async () => {
    const res = await recipesRoutes({} as any).request('/not-a-uuid/fork', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  test('404s when the source recipe is missing', async () => {
    // Built inline rather than through makeForkMock: drizzle's findFirst
    // returns undefined for a miss, which a defaulted parameter would swallow.
    const mock = makeDbMock({
      query: { recipes: { findFirst: vi.fn(async () => undefined) } },
    });
    const res = await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(404);
    expect(mock.writes).toEqual([]);
  });

  test('copies the recipe as a child with sourceType forked', async () => {
    const mock = makeForkMock();
    const res = await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(201);

    const recipeWrite = mock.writes.find((w) => w.table === tableNameOf(recipes));
    expect(recipeWrite?.values).toMatchObject({
      title: 'Roast chicken',
      sourceType: 'forked',
      parentRecipeId: RECIPE_ID,
      sourceUrl: 'https://example.com/roast',
      steps: SOURCE_RECIPE.steps,
      prepTime: 15,
      totalTime: 75,
      servings: 4,
      effortScore: 3,
      tags: ['dinner', 'chicken'],
      cuisineType: 'nordic',
    });
  });

  test('leaves the original\'s rating and cook count behind', async () => {
    const mock = makeForkMock();
    await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const values = mock.writes.find((w) => w.table === tableNameOf(recipes))
      ?.values as Record<string, unknown>;
    // A fork starts its own history: inheriting 5 stars and 7 cooks would make
    // the copy look battle-tested before it has ever been made.
    expect(values.userRating).toBeUndefined();
    expect(values.timesCooked).toBeUndefined();
    expect(values.id).toBeUndefined();
    expect(values.createdAt).toBeUndefined();
  });

  test('copies every ingredient line onto the fork', async () => {
    const mock = makeForkMock();
    await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const lines = mock.writes.find((w) => w.table === tableNameOf(recipeIngredients))
      ?.values as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      recipeId: FORK_ID,
      ingredientId: INGREDIENT_ID,
      quantity: '500',
      unit: 'g',
      optional: false,
      notes: 'free range',
    });
    expect(lines[1]).toMatchObject({ optional: true, notes: null, unit: 'tsp' });
  });

  test('accepts a title override in the body', async () => {
    const mock = makeForkMock();
    const res = await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Roast chicken, my way' }),
    });
    expect(res.status).toBe(201);
    expect(mock.writes.find((w) => w.table === tableNameOf(recipes))?.values).toMatchObject(
      { title: 'Roast chicken, my way' },
    );
  });

  test('rejects unknown body keys rather than silently dropping them', async () => {
    const res = await forkRequest(RECIPE_ID, { servings: 8 });
    expect(res.status).toBe(400);
  });

  test('forks a fork, parenting on the immediate source', async () => {
    const mock = makeForkMock({ ...SOURCE_RECIPE, sourceType: 'forked', parentRecipeId: FORK_ID });
    await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(mock.writes.find((w) => w.table === tableNameOf(recipes))?.values).toMatchObject({
      parentRecipeId: RECIPE_ID,
    });
  });

  test('skips the line insert when the source has no ingredients', async () => {
    const mock = makeForkMock({ ...SOURCE_RECIPE, recipeIngredients: [] });
    const res = await recipesRoutes(mock.db).request(`/${RECIPE_ID}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(201);
    // An empty .values([]) is a driver error, not an empty insert.
    expect(mock.writes.map((w) => w.table)).toEqual([tableNameOf(recipes)]);
  });
});
