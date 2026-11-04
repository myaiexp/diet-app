// Recipe create (POST) and update (PATCH) with their 4xx mappings

import { describe, test, expect } from 'vitest';
import { recipeIngredients } from '@diet-app/db';
import { recipesRoutes } from '../routes/recipes.js';
import { pgError } from './db-mock.js';
import { renderWhere, whereParams } from './drizzle-introspect.js';
import {
  INGREDIENT_ID,
  RECIPE_ID,
  RECIPE_WITH_RELATIONS,
  VALID_CREATE,
  fkViolationOn,
  makeWriteMock,
} from './recipes-test-helpers.js';

describe('recipesRoutes', () => {
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
    // The delete is scoped to this recipe. A where-less delete, or one keyed
    // on the line id, would still record a row and pass a length check.
    expect(deletes).toHaveLength(1);
    expect(whereParams(deletes[0])).toEqual([RECIPE_ID]);
    expect(renderWhere(deletes[0]).sql).toMatch(/recipe_id/);
    expect(inserts).toEqual([
      [
        {
          recipeId: RECIPE_ID,
          ingredientId: INGREDIENT_ID,
          quantity: '1',
          unit: 'kg',
          optional: false,
          notes: null,
        },
      ],
    ]);
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
});
