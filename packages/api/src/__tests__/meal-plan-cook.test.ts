// Mock-based tests for POST /meal-plans/:id/cook (FEFO auto-deduct) and its
// read-only twin GET /meal-plans/:id/cook-preview

import { describe, test, expect } from 'vitest';
import { type Table } from 'drizzle-orm';
import { mealPlanEntries, pantryItems, recipeIngredients, recipes } from '@diet-app/db';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { mealPlanCookRoutes } from '../routes/meal-plan-cook.js';
import { makeDbMock, type WriteRecord } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { tableNameOf, whereParams } from './drizzle-introspect.js';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SUB_RECIPE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const ING_ID = 'cccccccc-dddd-4eee-8fff-000000000001';
const PANTRY_ID = 'dddddddd-eeee-4fff-8000-111111111111';

const RECIPE = {
  id: RECIPE_ID,
  title: 'Roast chicken',
  servings: 2,
  timesCooked: 3,
};

const SUB_RECIPE = {
  id: SUB_RECIPE_ID,
  title: 'Substitute roast',
  servings: 2,
  timesCooked: 0,
};

const LINE = {
  id: 'eeeeeeee-ffff-4000-8000-222222222222',
  recipeId: RECIPE_ID,
  ingredientId: ING_ID,
  quantity: '500',
  unit: 'g',
  optional: false,
};

const PANTRY_ROW = {
  id: PANTRY_ID,
  ingredientId: ING_ID,
  quantity: '1000',
  unit: 'g',
  expiresDate: '2026-08-01',
  opened: false,
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

const PLANNED_ENTRY = {
  id: ENTRY_ID,
  date: '2026-07-20',
  slot: 'dinner',
  recipeId: RECIPE_ID,
  freeformNote: null,
  servings: '1',
  status: 'planned',
  substituteRecipeId: null,
  notes: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
};

type CookMockOpts = {
  entry?: unknown | null;
  recipe?: unknown | null;
  /** Map recipe id → row (for substitute resolution tests) */
  recipesById?: Record<string, unknown>;
  lines?: unknown[];
  /** Map recipe id → lines */
  linesByRecipeId?: Record<string, unknown[]>;
  pantryRows?: unknown[];
  cookedEntry?: unknown;
};

function makeCookMock(opts: CookMockOpts = {}) {
  let transactionOpened = false;

  const resolveEntry = () => (opts.entry === undefined ? { ...PLANNED_ENTRY } : opts.entry);

  const resolveRecipe = (id: unknown) => {
    if (opts.recipesById && typeof id === 'string' && id in opts.recipesById) {
      return opts.recipesById[id];
    }
    if (opts.recipe === undefined) return { ...RECIPE };
    return opts.recipe;
  };

  const resolveLines = (recipeId: unknown) => {
    if (opts.linesByRecipeId && typeof recipeId === 'string' && recipeId in opts.linesByRecipeId) {
      return opts.linesByRecipeId[recipeId]!;
    }
    if (opts.lines === undefined) return [{ ...LINE }];
    return opts.lines;
  };

  // Each read is answered by the table it named. The recipe/lines fixtures key
  // on the id the route bound into eq(), which is what proves the substitute
  // was resolved — the route may run these in any order.
  const router = makeSelectRouter([
    [
      mealPlanEntries,
      () => {
        const entry = resolveEntry();
        return entry == null ? [] : [entry];
      },
    ],
    [
      recipes,
      ({ params }) => {
        const recipe = resolveRecipe(params[0] ?? RECIPE_ID);
        return recipe == null ? [] : [recipe];
      },
    ],
    [recipeIngredients, ({ params }) => resolveLines(params[0] ?? RECIPE_ID)],
    [pantryItems, opts.pantryRows ?? [{ ...PANTRY_ROW }]],
  ]);

  const mock = makeDbMock({
    // Only the final "mark cooked" update reads a row back; key on that
    // statement's own values rather than on whichever write happened last.
    updateRows: (_recorded, record) => {
      const base = (opts.cookedEntry as object) ?? {
        ...PLANNED_ENTRY,
        ...(resolveEntry() as object),
      };
      const set = record.values as Record<string, unknown> | undefined;
      return [{ ...base, ...set, status: set?.['status'] ?? 'cooked' }];
    },
    select: router.select,
    beforeTransaction: () => {
      transactionOpened = true;
    },
  });

  const writesTo = (kind: WriteRecord['kind'], table: Table) =>
    mock.writes.filter((w) => w.kind === kind && w.table === tableNameOf(table));

  return {
    db: mock.db,
    /** Every write, in statement order — assert nothing extra was written. */
    writes: mock.writes,
    updatesTo: (table: Table) => writesTo('update', table),
    deletesTo: (table: Table) => writesTo('delete', table),
    reads: router.reads,
    wasOpened: () => transactionOpened,
  };
}

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

describe('GET /meal-plans/:id/cook-preview', () => {
  // Same fixture both sides: the whole claim is that preview and commit plan
  // identically, so anything that differs must be the write, not the input.
  const stockedOpts: CookMockOpts = {
    entry: { ...PLANNED_ENTRY, servings: '4' },
    recipe: { ...RECIPE, servings: 2 },
    lines: [{ ...LINE, quantity: '500', unit: 'g' }],
    pantryRows: [{ ...PANTRY_ROW, quantity: '2000', unit: 'g' }],
  };

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

    for (const raw of ['0', '-2', 'abc', '']) {
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

  test('is mounted on mealPlansRoutes at GET /:id/cook-preview', async () => {
    const { db } = makeCookMock(stockedOpts);
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}/cook-preview`);
    expect(res.status).toBe(200);
    expect((await res.json()).servings).toBe(4);
  });
});
