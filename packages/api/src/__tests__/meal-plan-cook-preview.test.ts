// Mock-based tests for GET /meal-plans/:id/cook-preview — the read-only twin of
// POST /:id/cook, sharing its fixtures from meal-plan-cook-mock.ts.

import { describe, test, expect } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { mealPlanCookRoutes } from '../routes/meal-plan-cook.js';
import {
  makeCookMock,
  STOCKED_OPTS,
  ENTRY_ID,
  ING_ID,
  PLANNED_ENTRY,
} from './meal-plan-cook-mock.js';

describe('GET /meal-plans/:id/cook-preview', () => {
  // STOCKED_OPTS is shared with the cook suite on purpose: the whole claim is
  // that preview and commit plan identically, so anything that differs must be
  // the write, not the input.
  const stockedOpts = STOCKED_OPTS;

  test('returns the same deduction plan as cook, without writing', async () => {
    const preview = makeCookMock(stockedOpts);
    const previewRes = await mealPlanCookRoutes(preview.db).request(
      `/${ENTRY_ID}/cook-preview`,
    );
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();

    // Nothing was written and no transaction was even opened.
    expect(preview.writes).toEqual([]);
    expect(preview.wasOpened()).toBe(false);

    const commit = makeCookMock(stockedOpts);
    const cookRes = await mealPlanCookRoutes(commit.db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(cookRes.status).toBe(200);
    const cookBody = await cookRes.json();

    expect(previewBody.deductions).toEqual(cookBody.deductions);
    expect(previewBody.shortfalls).toEqual(cookBody.shortfalls);
    // ...and the commit really did write, so the comparison isn't vacuous.
    expect(commit.writes.length).toBeGreaterThan(0);
  });

  test('defaults to the entry servings and takes no row locks', async () => {
    const { db, reads } = makeCookMock(stockedOpts);
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // entry 4 servings over a 2-serving recipe → scale 2 → 1000 g of the 500 g line
    expect(body.servings).toBe(4);
    expect(body.deductions[0].requested).toBe(1000);
    expect(body.deductions[0].pantryItems[0]).toMatchObject({
      before: '2000',
      after: '1000',
    });
    expect(reads.filter((r) => r.forUpdate)).toEqual([]);
  });

  test('honours a servings override without persisting it', async () => {
    const { db, writes } = makeCookMock(stockedOpts);
    const res = await mealPlanCookRoutes(db).request(
      `/${ENTRY_ID}/cook-preview?servings=8`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servings).toBe(8);
    // scale 8/2 = 4 → 2000 g requested, the whole 2000 g lot consumed
    expect(body.deductions[0].requested).toBe(2000);
    expect(body.deductions[0].pantryItems[0].deleted).toBe(true);
    expect(writes).toEqual([]);
  });

  test('reports shortfalls for ingredients absent from the pantry', async () => {
    const { db } = makeCookMock({ ...stockedOpts, pantryRows: [] });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions).toEqual([]);
    expect(body.shortfalls).toContainEqual(
      expect.objectContaining({ ingredientId: ING_ID, reason: 'not_in_pantry' }),
    );
  });

  test('previews a freeform entry as an empty plan', async () => {
    const { db } = makeCookMock({
      entry: {
        ...PLANNED_ENTRY,
        recipeId: null,
        substituteRecipeId: null,
        freeformNote: 'canteen',
      },
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deductions: [], shortfalls: [], servings: 1 });
  });

  test('404s for a missing entry', async () => {
    const { db } = makeCookMock({ entry: null });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('404s when the resolved recipe is missing', async () => {
    const { db } = makeCookMock({ entry: PLANNED_ENTRY, recipe: null });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('409s on an already-cooked entry', async () => {
    const { db } = makeCookMock({ entry: { ...PLANNED_ENTRY, status: 'cooked' } });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Meal plan entry already cooked' });
  });

  test('400s on a malformed id and on a non-positive servings query', async () => {
    const bad = await mealPlanCookRoutes({} as any).request('/not-a-uuid/cook-preview');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid id format' });

    for (const raw of ['0', '-2', 'abc', '', '13', '1e9', '0.5']) {
      const { db, writes } = makeCookMock(stockedOpts);
      const res = await mealPlanCookRoutes(db).request(
        `/${ENTRY_ID}/cook-preview?servings=${raw}`,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Validation failed',
        details: { formErrors: ['Invalid servings query'] },
      });
      expect(writes).toEqual([]);
    }
  });

  test('cook-preview at servings=12 still plans', async () => {
    const { db, writes } = makeCookMock(stockedOpts);
    const res = await mealPlanCookRoutes(db).request(
      `/${ENTRY_ID}/cook-preview?servings=12`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servings).toBe(12);
    // scale 12/2 = 6 → 3000 g requested against a 2000 g lot
    expect(body.deductions[0].requested).toBe(3000);
    expect(writes).toEqual([]);
  });

  test('is mounted on mealPlansRoutes at GET /:id/cook-preview', async () => {
    const { db } = makeCookMock(stockedOpts);
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(200);
    expect((await res.json()).servings).toBe(4);
  });
});
