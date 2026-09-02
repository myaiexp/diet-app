// Mock-based tests for POST /meal-plans/:id/cook (FEFO auto-deduct).
// The read-only twin GET /:id/cook-preview lives in meal-plan-cook-preview.test.ts;
// both drive the shared fixtures in meal-plan-cook-mock.ts.

import { describe, test, expect } from 'vitest';
import { asc } from 'drizzle-orm';
import { mealPlanEntries, pantryItems, recipes } from '@diet-app/db';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { mealPlanCookRoutes } from '../routes/meal-plan-cook.js';
import { whereParams } from './drizzle-introspect.js';
import {
  makeCookMock,
  ENTRY_ID,
  RECIPE_ID,
  SUB_RECIPE_ID,
  PANTRY_ID,
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

  test('cooks at 12 servings', async () => {
    const entry = { ...PLANNED_ENTRY, servings: '12' };
    const { db } = makeCookMock({
      entry,
      recipe: { ...RECIPE, servings: 2 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '4000', unit: 'g' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // scale 12/2 = 6 → 3000 g of the 500 g line
    expect(body.deductions[0].requested).toBe(3000);
    expect(body.entry.status).toBe('cooked');
  });

  test('loads pantry rows ordered by id (FEFO last-tie)', async () => {
    const { db, reads } = makeCookMock();
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const pantry = reads.find((r) => r.table === 'pantry_items');
    expect(pantry?.orderBy).toEqual([asc(pantryItems.id)]);
  });

  test('scales the deduction by entry servings over recipe servings', async () => {
    // recipe.servings 2, entry.servings 4 → scale 2; line 500g → need 1000g
    const entry = { ...PLANNED_ENTRY, servings: '4' };
    const { db } = makeCookMock({
      entry,
      recipe: { ...RECIPE, servings: 2 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '2000', unit: 'g' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions[0].requested).toBe(1000);
    expect(body.deductions[0].deducted).toBe(1000);
    expect(body.deductions[0].pantryItems[0]).toMatchObject({
      before: '2000',
      after: '1000',
      deleted: false,
    });
  });

  test('applies planner output: updates touched rows, deletes zeroed rows, bumps timesCooked', async () => {
    const { db, deletesTo } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '2' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '1000', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '1000', unit: 'g' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions[0].pantryItems[0].deleted).toBe(true);
    const pantryDeletes = deletesTo(pantryItems);
    expect(pantryDeletes).toHaveLength(1);
    expect(whereParams(pantryDeletes[0]!.where)).toContain(PANTRY_ID);

    // partial update path: leftover stock
    const partial = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '1000', unit: 'g' }],
    });
    const res2 = await mealPlanCookRoutes(partial.db).request(
      `/${ENTRY_ID}/cook`,
      { method: 'POST' },
    );
    expect(res2.status).toBe(200);
    const pantryUpdates = partial.updatesTo(pantryItems);
    expect(pantryUpdates).toHaveLength(1);
    expect(pantryUpdates[0]!.values).toMatchObject({ quantity: '500' });
    expect(partial.deletesTo(pantryItems)).toHaveLength(0);

    // timesCooked increment present
    expect(partial.updatesTo(recipes)).toHaveLength(1);

    // entry status cooked
    const statusUpdates = partial.updatesTo(mealPlanEntries);
    expect(statusUpdates).toHaveLength(1);
    expect(statusUpdates[0]!.values).toMatchObject({ status: 'cooked' });
  });

  test('FEFO cook spanning two lots deletes the sooner and updates the later (finding #8018)', async () => {
    const soonerId = 'dddddddd-eeee-4fff-8000-222222222222';
    const laterId = 'dddddddd-eeee-4fff-8000-333333333333';
    const { db, updatesTo, deletesTo } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [
        { ...PANTRY_ROW, id: laterId, quantity: '400', unit: 'g', expiresDate: '2026-09-01' },
        { ...PANTRY_ROW, id: soonerId, quantity: '300', unit: 'g', expiresDate: '2026-07-01' },
      ],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions[0].pantryItems).toEqual([
      { id: soonerId, unit: 'g', before: '300', after: '0', deleted: true },
      { id: laterId, unit: 'g', before: '400', after: '200', deleted: false },
    ]);

    const pantryDeletes = deletesTo(pantryItems);
    expect(pantryDeletes).toHaveLength(1);
    expect(whereParams(pantryDeletes[0]!.where)).toContain(soonerId);

    const pantryUpdates = updatesTo(pantryItems);
    expect(pantryUpdates).toHaveLength(1);
    expect(pantryUpdates[0]!.values).toMatchObject({ quantity: '200' });
    expect(whereParams(pantryUpdates[0]!.where)).toContain(laterId);

    expect(updatesTo(recipes)).toHaveLength(1);
  });

  test('two recipe lines sharing one lot UPDATE then DELETE the same id (finding #8018)', async () => {
    const lineB = {
      ...LINE,
      id: 'eeeeeeee-ffff-4000-8000-333333333333',
      quantity: '400',
    };
    const { db, updatesTo, deletesTo } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [
        { ...LINE, quantity: '400', unit: 'g' },
        lineB,
      ],
      pantryRows: [{ ...PANTRY_ROW, quantity: '600', unit: 'g' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions).toHaveLength(2);
    expect(body.deductions[0].pantryItems[0]).toMatchObject({
      id: PANTRY_ID,
      before: '600',
      after: '200',
      deleted: false,
    });
    expect(body.deductions[1].pantryItems[0]).toMatchObject({
      id: PANTRY_ID,
      before: '200',
      after: '0',
      deleted: true,
    });

    const pantryUpdates = updatesTo(pantryItems);
    expect(pantryUpdates).toHaveLength(1);
    expect(pantryUpdates[0]!.values).toMatchObject({ quantity: '200' });
    expect(whereParams(pantryUpdates[0]!.where)).toContain(PANTRY_ID);

    const pantryDeletes = deletesTo(pantryItems);
    expect(pantryDeletes).toHaveLength(1);
    expect(whereParams(pantryDeletes[0]!.where)).toContain(PANTRY_ID);

    expect(updatesTo(recipes)).toHaveLength(1);
  });

  test('a shortfall does not prevent the cook', async () => {
    const { db } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [], // nothing in pantry
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.status).toBe('cooked');
    expect(body.shortfalls).toHaveLength(1);
    expect(body.shortfalls[0].reason).toBe('not_in_pantry');
    expect(body.deductions).toEqual([]);
  });

  test('response quantities are stringified like every other numeric column', async () => {
    // planner yields { before: 1, after: 0.5 } for 500g from 1 kg
    const { db } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '1', unit: 'kg' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions[0].pantryItems[0]).toEqual({
      id: PANTRY_ID,
      unit: 'kg',
      before: '1',
      after: '0.5',
      deleted: false,
    });
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