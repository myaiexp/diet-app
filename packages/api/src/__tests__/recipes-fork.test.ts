// Mock-based route tests for POST /recipes/:id/fork (idea #2660).

import { describe, test, expect, vi } from 'vitest';
import { recipeIngredients, recipes } from '@diet-app/db';
import { recipesRoutes } from '../routes/recipes.js';
import { makeDbMock, type DbMock } from './db-mock.js';
import { tableNameOf } from './drizzle-introspect.js';
import { INGREDIENT_ID, RECIPE_ID } from './recipes-test-helpers.js';

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
