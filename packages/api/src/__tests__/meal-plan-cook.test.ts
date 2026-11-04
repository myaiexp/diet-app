// POST /meal-plans/:id/cook: guards, freeform, substitute and lock paths
// The deduction math is in meal-plan-cook-deduction.test.ts, the body servings in meal-plan-cook-body.test.ts.
// The read-only twin GET /:id/cook-preview lives in meal-plan-cook-preview.test.ts;
// all drive the shared fixtures in meal-plan-cook-mock.ts.

import { describe, test, expect } from 'vitest';
import { mealPlanEntries, pantryItems, recipes } from '@diet-app/db';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { mealPlanCookRoutes } from '../routes/meal-plan-cook.js';
import { whereParams } from './drizzle-introspect.js';
import {
  makeCookMock,
  ENTRY_ID,
  RECIPE_ID,
  SUB_RECIPE_ID,
  RECIPE,
  SUB_RECIPE,
  LINE,
  PANTRY_ROW,
  PLANNED_ENTRY,
} from './meal-plan-cook-mock.js';

describe('mealPlanCookRoutes', () => {
  test('returns 400 for a malformed id without touching the db', async () => {
    let opened = false;
    const db = {
      transaction: async () => {
        opened = true;
      },
    } as any;
    const res = await mealPlanCookRoutes(db).request('/not-a-uuid/cook', {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid id format' });
    expect(opened).toBe(false);
  });

  test('returns 404 for a missing entry', async () => {
    const mock = makeCookMock({ entry: null });
    const res = await mealPlanCookRoutes(mock.db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(mock.wasOpened()).toBe(true);
  });

  test('returns 409 when the entry is already cooked', async () => {
    const { db } = makeCookMock({
      entry: { ...PLANNED_ENTRY, status: 'cooked' },
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Meal plan entry already cooked',
    });
  });

  test('cooks a freeform entry with no recipe: status flips, nothing deducted', async () => {
    const freeform = {
      ...PLANNED_ENTRY,
      recipeId: null,
      substituteRecipeId: null,
      freeformNote: 'takeaway',
    };
    const { db, writes, updatesTo } = makeCookMock({
      entry: freeform,
      cookedEntry: { ...freeform, status: 'cooked' },
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions).toEqual([]);
    expect(body.shortfalls).toEqual([]);
    expect(body.entry.status).toBe('cooked');
    // only the entry status update — no pantry writes, no timesCooked
    const entryUpdates = updatesTo(mealPlanEntries);
    expect(entryUpdates).toHaveLength(1);
    expect(entryUpdates[0]!.values).toMatchObject({ status: 'cooked' });
    expect(writes).toHaveLength(1);
  });

  test('prefers substituteRecipeId over recipeId when resolving the recipe', async () => {
    const entry = {
      ...PLANNED_ENTRY,
      recipeId: RECIPE_ID,
      substituteRecipeId: SUB_RECIPE_ID,
      servings: '2',
    };
    const subLine = { ...LINE, recipeId: SUB_RECIPE_ID, quantity: '100', unit: 'g' };
    const { db, updatesTo } = makeCookMock({
      entry,
      recipesById: {
        [SUB_RECIPE_ID]: SUB_RECIPE,
        [RECIPE_ID]: RECIPE,
      },
      linesByRecipeId: {
        [SUB_RECIPE_ID]: [subLine],
        [RECIPE_ID]: [{ ...LINE, quantity: '9999' }],
      },
      pantryRows: [{ ...PANTRY_ROW, quantity: '500' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // scale = 2/2 = 1; sub line 100g from 500g pantry → after 400
    // (primary recipe line is 9999g — would not yield requested 100 if used)
    expect(body.deductions).toHaveLength(1);
    expect(body.deductions[0].requested).toBe(100);
    expect(body.deductions[0].pantryItems[0].after).toBe('400');
    // timesCooked must target the substitute, not the primary recipe
    const recipeUpdates = updatesTo(recipes);
    expect(recipeUpdates).toHaveLength(1);
    expect(whereParams(recipeUpdates[0]!.where)).toContain(SUB_RECIPE_ID);
    expect(whereParams(recipeUpdates[0]!.where)).not.toContain(RECIPE_ID);
  });

  test('entry and pantry selects use FOR UPDATE; recipe/lines do not', async () => {
    const { db, reads } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '100', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '500' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    // Which rows the cook locks — the claim is about the tables, not the order
    // the route happens to read them in.
    const locked = reads.filter((r) => r.forUpdate).map((r) => r.table);
    const unlocked = reads.filter((r) => !r.forUpdate).map((r) => r.table);
    expect([...locked].sort()).toEqual(['meal_plan_entries', 'pantry_items']);
    expect([...unlocked].sort()).toEqual(['recipe_ingredients', 'recipes']);
  });

  test('returns 404 when resolved recipe is missing', async () => {
    const { db } = makeCookMock({
      entry: PLANNED_ENTRY,
      recipe: null,
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('cooks an ingredient-less recipe: marks cooked, bumps timesCooked, writes no pantry', async () => {
    const { db, writes, updatesTo, deletesTo, reads } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [],
      pantryRows: [{ ...PANTRY_ROW }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.status).toBe('cooked');
    expect(body.deductions).toEqual([]);
    expect(body.shortfalls).toEqual([]);

    expect(updatesTo(mealPlanEntries)).toHaveLength(1);
    expect(updatesTo(mealPlanEntries)[0]!.values).toMatchObject({ status: 'cooked' });
    expect(updatesTo(recipes)).toHaveLength(1);
    expect(whereParams(updatesTo(recipes)[0]!.where)).toContain(RECIPE_ID);
    expect(updatesTo(pantryItems)).toHaveLength(0);
    expect(deletesTo(pantryItems)).toHaveLength(0);
    expect(writes).toHaveLength(2);

    // loadCookPlan skips the pantry FOR UPDATE when the recipe has no lines.
    expect(reads.filter((r) => r.table === 'pantry_items')).toEqual([]);
  });

  test('returns 400 when the recipe base servings is negative', async () => {
    const { db, writes } = makeCookMock({
      entry: PLANNED_ENTRY,
      recipe: { ...RECIPE, servings: -2 },
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid servings scale' });
    expect(writes).toEqual([]);
  });

  test('returns 400 when servings scale is non-finite', async () => {
    const { db } = makeCookMock({
      entry: PLANNED_ENTRY,
      recipe: { ...RECIPE, servings: 0 },
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid servings scale' });
  });

  test('returns 400 when stored entry servings is above 12', async () => {
    const { db, writes } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1e9' },
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid servings scale' });
    expect(writes).toEqual([]);
  });

  test('is mounted on mealPlansRoutes at POST /:id/cook', async () => {
    const { db } = makeCookMock({
      entry: {
        ...PLANNED_ENTRY,
        recipeId: null,
        substituteRecipeId: null,
        freeformNote: 'out',
      },
    });
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).entry.status).toBe('cooked');
  });
});
