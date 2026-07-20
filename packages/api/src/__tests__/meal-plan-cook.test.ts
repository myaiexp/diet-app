// Mock-based tests for POST /meal-plans/:id/cook (FEFO auto-deduct)

import { describe, test, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { mealPlanCookRoutes } from '../routes/meal-plan-cook.js';

const dialect = new PgDialect();

function whereParams(where: unknown): unknown[] {
  try {
    return dialect.sqlToQuery(where as any).params;
  } catch {
    return [];
  }
}

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
  const updates: { table: string; set: unknown; where?: unknown }[] = [];
  const deletes: { table: string; id?: unknown }[] = [];
  const selectMeta: { forUpdate: boolean; from: string }[] = [];
  let transactionOpened = false;
  let selectCall = 0;

  // Table identity: drizzle table objects are unique references
  const tableName = (t: unknown): string => {
    const anyT = t as { [k: string]: unknown };
    // drizzle tables expose Symbol.for('drizzle:Name') or similar; fall back to order
    const name =
      (anyT as any)[Symbol.for('drizzle:Name')] ??
      (anyT as any)._?.name ??
      (anyT as any)[Object.getOwnPropertySymbols(anyT as object)[0] ?? ''];
    if (typeof name === 'string') return name;
    return 'unknown';
  };

  const resolveEntry = () =>
    opts.entry === undefined ? { ...PLANNED_ENTRY } : opts.entry;

  const resolveRecipe = (id: unknown) => {
    if (opts.recipesById && typeof id === 'string' && id in opts.recipesById) {
      return opts.recipesById[id];
    }
    if (opts.recipe === undefined) return { ...RECIPE };
    return opts.recipe;
  };

  const resolveLines = (recipeId: unknown) => {
    if (
      opts.linesByRecipeId &&
      typeof recipeId === 'string' &&
      recipeId in opts.linesByRecipeId
    ) {
      return opts.linesByRecipeId[recipeId]!;
    }
    if (opts.lines === undefined) return [{ ...LINE }];
    return opts.lines;
  };

  // Sequential select results when for/where filters aren't introspectable:
  // call 0 = entry; 1 = recipe; 2 = lines; 3 = pantry (if any)
  // We inspect forUpdate + call order and eq() is opaque — track by order.
  const buildSelect = (txMode: boolean) => {
    return (_cols?: unknown) => {
      const idx = selectCall++;
      let forUpdate = false;
      let fromTable = 'unknown';
      let whereArg: unknown;

      const builder: any = {
        from: (t: unknown) => {
          fromTable = tableName(t);
          return builder;
        },
        where: (w: unknown) => {
          whereArg = w;
          return builder;
        },
        for: (_strength: string) => {
          forUpdate = true;
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => {
          selectMeta.push({ forUpdate, from: fromTable });
          const params = whereParams(whereArg);

          // Order-based resolution matching the route's query sequence
          if (idx === 0) {
            // entry FOR UPDATE
            const entry = resolveEntry();
            return resolve(entry == null ? [] : [entry]);
          }

          // After entry: recipe load (no for), lines (no for), pantry (for)
          if (!forUpdate) {
            const nonForAfterEntry = selectMeta.filter(
              (m, i) => i > 0 && !m.forUpdate,
            ).length;
            // Use the actual eq() param the route passed — proves which recipe id was loaded
            const queriedId =
              typeof params[0] === 'string' ? params[0] : undefined;
            if (nonForAfterEntry <= 1) {
              const recipe = resolveRecipe(queriedId ?? RECIPE_ID);
              return resolve(recipe == null ? [] : [recipe]);
            }
            return resolve(resolveLines(queriedId ?? RECIPE_ID));
          }

          // pantry FOR UPDATE
          return resolve(opts.pantryRows ?? [{ ...PANTRY_ROW }]);
        },
      };
      // silence unused
      void whereArg;
      void txMode;
      return builder;
    };
  };

  const makeWriteSide = () => {
    const update = (_table: unknown) => {
      const tName = tableName(_table);
      let whereArg: unknown;
      const builder: any = {
        set: (v: unknown) => {
          updates.push({ table: tName, set: v, where: undefined });
          return builder;
        },
        where: (w: unknown) => {
          whereArg = w;
          const last = updates[updates.length - 1];
          if (last) last.where = w;
          return builder;
        },
        returning: async () => {
          const last = updates[updates.length - 1]?.set as Record<string, unknown>;
          const base =
            (opts.cookedEntry as object) ??
            { ...PLANNED_ENTRY, ...(resolveEntry() as object) };
          return [{ ...base, ...last, status: last?.status ?? 'cooked' }];
        },
      };
      void whereArg;
      return builder;
    };
    const del = (_table: unknown) => {
      const tName = tableName(_table);
      const builder: any = {
        where: (w: unknown) => {
          deletes.push({ table: tName, id: whereParams(w)[0] });
          return builder;
        },
      };
      return builder;
    };
    return { update, delete: del };
  };

  const writes = makeWriteSide();

  const tx = {
    select: buildSelect(true),
    update: writes.update,
    delete: writes.delete,
  };

  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      transactionOpened = true;
      selectCall = 0;
      return fn(tx);
    },
    // top-level unused for cook path
    select: buildSelect(false),
    update: writes.update,
    delete: writes.delete,
  } as any;

  return {
    db,
    updates,
    deletes,
    selectMeta,
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
    const { db, updates, deletes } = makeCookMock({
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
    expect(deletes).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set).toMatchObject({ status: 'cooked' });
  });

  test('prefers substituteRecipeId over recipeId when resolving the recipe', async () => {
    const entry = {
      ...PLANNED_ENTRY,
      recipeId: RECIPE_ID,
      substituteRecipeId: SUB_RECIPE_ID,
      servings: '2',
    };
    const subLine = { ...LINE, recipeId: SUB_RECIPE_ID, quantity: '100', unit: 'g' };
    const { db, updates } = makeCookMock({
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
    const recipeUpdates = updates.filter(
      (u) => (u.set as any).timesCooked !== undefined,
    );
    expect(recipeUpdates).toHaveLength(1);
    expect(whereParams(recipeUpdates[0]!.where)).toContain(SUB_RECIPE_ID);
    expect(whereParams(recipeUpdates[0]!.where)).not.toContain(RECIPE_ID);
  });

  test('entry and pantry selects use FOR UPDATE; recipe/lines do not', async () => {
    const { db, selectMeta } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '100', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '500' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    // [entry for], [recipe no], [lines no], [pantry for]
    expect(selectMeta.map((m) => m.forUpdate)).toEqual([true, false, false, true]);
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
    // exact consume 1000g from 1000g → delete row
    const { db, updates, deletes } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '2' }, // scale = 2/2 = 1, need 500... use 1000 line
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
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.id).toBe(PANTRY_ID);

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
    const pantryUpdates = partial.updates.filter(
      (u) => (u.set as any).quantity !== undefined,
    );
    expect(pantryUpdates).toHaveLength(1);
    expect(pantryUpdates[0]!.set).toMatchObject({ quantity: '500' });
    expect(partial.deletes).toHaveLength(0);

    // timesCooked increment present
    const timesBumps = partial.updates.filter(
      (u) => (u.set as any).timesCooked !== undefined,
    );
    expect(timesBumps).toHaveLength(1);

    // entry status cooked
    const statusUpdates = partial.updates.filter(
      (u) => (u.set as any).status === 'cooked',
    );
    expect(statusUpdates).toHaveLength(1);
    void updates; // first case already asserted deletes
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
