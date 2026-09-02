// Fixtures and the db mock shared by the cook and cook-preview suites.
//
// POST /cook and GET /cook-preview run the same planner over the same four
// reads, so the fixture set is one thing, not two — keeping it here is what
// lets the preview suite assert "preview plans exactly what commit plans"
// against a literally identical input rather than a hand-copied lookalike.

import { type Table } from 'drizzle-orm';
import { mealPlanEntries, pantryItems, recipeIngredients, recipes } from '@diet-app/db';
import { makeDbMock, type WriteRecord } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { tableNameOf } from './drizzle-introspect.js';

export const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
export const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const SUB_RECIPE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
export const ING_ID = 'cccccccc-dddd-4eee-8fff-000000000001';
export const PANTRY_ID = 'dddddddd-eeee-4fff-8000-111111111111';

export const RECIPE = {
  id: RECIPE_ID,
  title: 'Roast chicken',
  servings: 2,
  timesCooked: 3,
};

export const SUB_RECIPE = {
  id: SUB_RECIPE_ID,
  title: 'Substitute roast',
  servings: 2,
  timesCooked: 0,
};

export const LINE = {
  id: 'eeeeeeee-ffff-4000-8000-222222222222',
  recipeId: RECIPE_ID,
  ingredientId: ING_ID,
  quantity: '500',
  unit: 'g',
  optional: false,
};

export const PANTRY_ROW = {
  id: PANTRY_ID,
  ingredientId: ING_ID,
  quantity: '1000',
  unit: 'g',
  expiresDate: '2026-08-01',
  opened: false,
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

export const PLANNED_ENTRY = {
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

export type CookMockOpts = {
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

export function makeCookMock(opts: CookMockOpts = {}) {
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

/**
 * The stocked entry both suites plan against: 4 servings of a 2-serving recipe
 * (scale 2) over a 2000 g lot. Preview and commit share it so any difference
 * between them has to be the write, not the input.
 */
export const STOCKED_OPTS: CookMockOpts = {
  entry: { ...PLANNED_ENTRY, servings: '4' },
  recipe: { ...RECIPE, servings: 2 },
  lines: [{ ...LINE, quantity: '500', unit: 'g' }],
  pantryRows: [{ ...PANTRY_ROW, quantity: '2000', unit: 'g' }],
};
