// Pure shopping-list demand/supply aggregation coverage

import { describe, test, expect } from 'vitest';
import {
  aggregateShoppingList,
  type PlanEntry,
  type AggregateRecipeLine,
  type PantrySupplyRow,
} from '../shopping-aggregate.js';

const TODAY = '2026-08-04'; // a Tuesday
const MONDAY = '2026-08-03'; // the day before TODAY, still inside the current week
const WEDNESDAY = '2026-08-05';
const THURSDAY = '2026-08-06';
const FRIDAY = '2026-08-07';
const SATURDAY = '2026-08-08';
const SUNDAY = '2026-08-09';

const ENTRY = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  id: 'e1',
  recipeId: 'r1',
  substituteRecipeId: null,
  servings: 4,
  status: 'planned',
  date: TODAY,
  ...over,
});

const LINE = (over: Partial<AggregateRecipeLine> = {}): AggregateRecipeLine => ({
  ingredientId: 'i1',
  quantity: 400,
  unit: 'g',
  optional: false,
  ...over,
});

const ROW = (over: Partial<PantrySupplyRow> = {}): PantrySupplyRow => ({
  ingredientId: 'i1',
  quantity: 300,
  unit: 'g',
  expiresDate: '2026-08-10',
  ...over,
});

type Input = Parameters<typeof aggregateShoppingList>[0];

const baseInput = (over: Partial<Input> = {}): Input => ({
  entries: [ENTRY()],
  recipesById: new Map([['r1', { servings: 4 }]]),
  linesByRecipe: new Map([['r1', [LINE()]]]),
  pantryRows: [],
  ingredientsById: new Map([['i1', { category: 'produce' }]]),
  today: TODAY,
  ...over,
});

describe('aggregateShoppingList', () => {
  test('aggregates the same ingredient across two recipes into one row', () => {
    const input = baseInput({
      entries: [ENTRY({ id: 'e1', recipeId: 'r1' }), ENTRY({ id: 'e2', recipeId: 'r2' })],
      recipesById: new Map([
        ['r1', { servings: 4 }],
        ['r2', { servings: 4 }],
      ]),
      linesByRecipe: new Map([
        ['r1', [LINE({ quantity: 400 })]],
        ['r2', [LINE({ quantity: 500 })]],
      ]),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(skipped).toEqual([]);
    expect(items).toEqual([
      {
        ingredientId: 'i1',
        unit: 'g',
        quantityNeeded: 900,
        quantityInPantry: 0,
        netToBuy: 900,
        category: 'produce',
      },
    ]);
  });

  test('splits one ingredient across dimensions into separate rows', () => {
    const input = baseInput({
      linesByRecipe: new Map([
        ['r1', [LINE({ quantity: 400, unit: 'g' }), LINE({ quantity: 2, unit: 'pieces' })]],
      ]),
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toEqual([
      {
        ingredientId: 'i1',
        unit: 'g',
        quantityNeeded: 400,
        quantityInPantry: 0,
        netToBuy: 400,
        category: 'produce',
      },
      {
        ingredientId: 'i1',
        unit: 'pieces',
        quantityNeeded: 2,
        quantityInPantry: 0,
        netToBuy: 2,
        category: 'produce',
      },
    ]);
  });

  test('scales lines by entry servings over recipe servings', () => {
    const input = baseInput({
      entries: [ENTRY({ servings: 2 })],
      recipesById: new Map([['r1', { servings: 4 }]]),
      linesByRecipe: new Map([['r1', [LINE({ quantity: 400 })]]]),
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]!.quantityNeeded).toBe(200);
  });

  test('converts non-base units to the dimension base', () => {
    const input = baseInput({
      linesByRecipe: new Map([
        [
          'r1',
          [LINE({ ingredientId: 'i1', quantity: 0.5, unit: 'kg' }), LINE({ ingredientId: 'i2', quantity: 1, unit: 'l' })],
        ],
      ]),
      ingredientsById: new Map([
        ['i1', { category: 'produce' }],
        ['i2', { category: 'dairy' }],
      ]),
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toContainEqual(
      expect.objectContaining({ ingredientId: 'i1', unit: 'g', quantityNeeded: 500 }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ ingredientId: 'i2', unit: 'ml', quantityNeeded: 1000 }),
    );
  });

  test('excludes optional lines', () => {
    const input = baseInput({
      linesByRecipe: new Map([['r1', [LINE({ optional: true })]]]),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('includes optional lines when includeOptional is set', () => {
    const input = baseInput({
      linesByRecipe: new Map([['r1', [LINE({ optional: true })]]]),
      includeOptional: true,
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantityNeeded: 400, netToBuy: 400 });
  });

  test('an optional line opted in still nets against the pantry like any other', () => {
    const input = baseInput({
      linesByRecipe: new Map([['r1', [LINE({ optional: true })]]]),
      pantryRows: [ROW({ quantity: 150 })],
      includeOptional: true,
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]).toMatchObject({ quantityInPantry: 150, netToBuy: 250 });
  });

  test('excludes cooked entries', () => {
    const input = baseInput({ entries: [ENTRY({ status: 'cooked' })] });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('excludes skipped entries', () => {
    const input = baseInput({ entries: [ENTRY({ status: 'skipped' })] });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('includes substituted entries using substituteRecipeId', () => {
    const input = baseInput({
      entries: [ENTRY({ status: 'substituted', recipeId: null, substituteRecipeId: 'r2' })],
      recipesById: new Map([['r2', { servings: 4 }]]),
      linesByRecipe: new Map([['r2', [LINE({ ingredientId: 'iSub', quantity: 200 })]]]),
      ingredientsById: new Map([['iSub', { category: 'produce' }]]),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ingredientId: 'iSub', quantityNeeded: 200 });
  });

  test('prefers substituteRecipeId over recipeId when both are set', () => {
    const input = baseInput({
      entries: [ENTRY({ status: 'planned', recipeId: 'r1', substituteRecipeId: 'r2' })],
      recipesById: new Map([
        ['r1', { servings: 4 }],
        ['r2', { servings: 4 }],
      ]),
      linesByRecipe: new Map([
        ['r1', [LINE({ ingredientId: 'iOrig', quantity: 100 })]],
        ['r2', [LINE({ ingredientId: 'iSub', quantity: 200 })]],
      ]),
      ingredientsById: new Map([
        ['iOrig', { category: 'produce' }],
        ['iSub', { category: 'produce' }],
      ]),
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ingredientId: 'iSub', quantityNeeded: 200 });
  });

  test('ignores freeform entries with no recipe', () => {
    const input = baseInput({
      entries: [ENTRY({ recipeId: null, substituteRecipeId: null })],
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('subtracts pantry stock in the same dimension', () => {
    const input = baseInput({
      linesByRecipe: new Map([
        ['r1', [LINE({ quantity: 400 }), LINE({ quantity: 500 })]],
      ]),
      pantryRows: [ROW({ quantity: 300 })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]).toMatchObject({ quantityNeeded: 900, quantityInPantry: 300, netToBuy: 600 });
  });

  test('ignores pantry stock in a different dimension', () => {
    const input = baseInput({
      linesByRecipe: new Map([
        ['r1', [LINE({ quantity: 400 }), LINE({ quantity: 500 })]],
      ]),
      pantryRows: [ROW({ quantity: 2, unit: 'pieces' })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]).toMatchObject({ quantityNeeded: 900, quantityInPantry: 0, netToBuy: 900 });
  });

  test('excludes pantry rows expired before today', () => {
    const input = baseInput({
      pantryRows: [ROW({ quantity: 300, expiresDate: '2026-08-03' })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]).toMatchObject({ quantityInPantry: 0, netToBuy: 400 });
  });

  test('counts a pantry row expiring exactly today', () => {
    const input = baseInput({
      pantryRows: [ROW({ quantity: 300, expiresDate: TODAY })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]).toMatchObject({ quantityInPantry: 300, netToBuy: 100 });
  });

  test('floors netToBuy at zero and caps quantityInPantry at quantityNeeded when pantry covers demand', () => {
    // Surplus stock (500 g) against 200 g of demand: the simulation only ever
    // consumes what's needed, so quantityInPantry reads 200, not the raw 500 g
    // sitting on the shelf — that raw total isn't a coherent answer once
    // "available" is date-dependent (see GeneratedItem.quantityInPantry).
    const input = baseInput({
      linesByRecipe: new Map([['r1', [LINE({ quantity: 200 })]]]),
      pantryRows: [ROW({ quantity: 500 })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantityNeeded: 200, quantityInPantry: 200, netToBuy: 0 });
  });

  test('keeps fully covered rows rather than dropping them', () => {
    const input = baseInput({
      linesByRecipe: new Map([['r1', [LINE({ quantity: 200 })]]]),
      pantryRows: [ROW({ quantity: 200 })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toHaveLength(1);
    expect(items[0]!.netToBuy).toBe(0);
  });

  test('reports a line with an unresolvable unit as skipped', () => {
    const input = baseInput({
      linesByRecipe: new Map([['r1', [LINE({ unit: 'pinch' })]]]),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ ingredientId: 'i1', entryId: 'e1', reason: 'unknown_unit' }]);
  });

  test('does not cover gram demand with a pantry row whose unit cannot resolve', () => {
    // Demand-side unknown_unit is a skip; pantry-side unknown is silent. A
    // handful on the shelf must not count as grams covering the 400 g line —
    // that would under-buy. skipped stays empty because this is not demand.
    const input = baseInput({
      pantryRows: [ROW({ quantity: 999, unit: 'handful' })],
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(skipped).toEqual([]);
    expect(items).toEqual([
      {
        ingredientId: 'i1',
        unit: 'g',
        quantityNeeded: 400,
        quantityInPantry: 0,
        netToBuy: 400,
        category: 'produce',
      },
    ]);
  });

  test('reports an entry whose recipe is missing from recipesById', () => {
    const input = baseInput({
      entries: [ENTRY({ recipeId: 'rMissing' })],
      recipesById: new Map(),
      linesByRecipe: new Map(),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ ingredientId: null, entryId: 'e1', reason: 'recipe_missing' }]);
  });

  test('reports a non-finite scale as bad_scale', () => {
    const input = baseInput({
      recipesById: new Map([['r1', { servings: 0 }]]),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ ingredientId: null, entryId: 'e1', reason: 'bad_scale' }]);
  });

  test('reports an out-of-range entry servings as bad_scale', () => {
    const input = baseInput({
      entries: [ENTRY({ servings: 1e9 })],
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ ingredientId: null, entryId: 'e1', reason: 'bad_scale' }]);
  });

  test('rounds quantities to six decimals', () => {
    const input = baseInput({
      entries: [ENTRY({ servings: 1 })],
      recipesById: new Map([['r1', { servings: 3 }]]),
      linesByRecipe: new Map([['r1', [LINE({ quantity: 100 })]]]),
    });
    const { items } = aggregateShoppingList(input);
    expect(items[0]!.quantityNeeded).toBe(33.333333);
  });

  test('treats a recipe with no lines as contributing nothing, not an error', () => {
    const input = baseInput({
      linesByRecipe: new Map(),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('ignores pantry rows for ingredients with no demand at all', () => {
    const input = baseInput({
      pantryRows: [ROW({ ingredientId: 'iUnrelated', quantity: 999 })],
    });
    const { items } = aggregateShoppingList(input);
    expect(items).toHaveLength(1);
    expect(items.some((item) => item.ingredientId === 'iUnrelated')).toBe(false);
  });

  test('falls back to the other category when the ingredient is unknown', () => {
    // category is a display grouping, not a correctness input — a missing
    // catalog row must not drop a real item off the shopping list.
    const input = baseInput({ ingredientsById: new Map() });
    const { items, skipped } = aggregateShoppingList(input);
    expect(skipped).toEqual([]);
    expect(items[0]).toMatchObject({ ingredientId: 'i1', category: 'other' });
  });

  test('does not mutate its inputs', () => {
    const entry = Object.freeze(ENTRY());
    const entries = Object.freeze([entry]) as unknown as PlanEntry[];
    const line = Object.freeze(LINE());
    const lines = Object.freeze([line]) as unknown as AggregateRecipeLine[];
    const row = Object.freeze(ROW());
    const pantryRows = Object.freeze([row]) as unknown as PantrySupplyRow[];
    const recipe = Object.freeze({ servings: 4 });
    const recipesById = new Map([['r1', recipe]]);
    const ingredient = Object.freeze({ category: 'produce' });
    const ingredientsById = new Map([['i1', ingredient]]);

    expect(() =>
      aggregateShoppingList({
        entries,
        recipesById,
        linesByRecipe: new Map([['r1', lines]]),
        pantryRows,
        ingredientsById,
        today: TODAY,
      }),
    ).not.toThrow();

    expect(entries).toEqual([ENTRY()]);
    expect(lines).toEqual([LINE()]);
    expect(pantryRows).toEqual([ROW()]);
    expect(recipesById.get('r1')).toEqual({ servings: 4 });
    expect(ingredientsById.get('i1')).toEqual({ category: 'produce' });
  });

  test('returns a deterministic item order for identical input', () => {
    const input = () =>
      baseInput({
        entries: [ENTRY({ id: 'e1', recipeId: 'r1' }), ENTRY({ id: 'e2', recipeId: 'r2' })],
        recipesById: new Map([
          ['r1', { servings: 4 }],
          ['r2', { servings: 4 }],
        ]),
        linesByRecipe: new Map([
          ['r1', [LINE({ ingredientId: 'iZ', quantity: 100 }), LINE({ ingredientId: 'iA', quantity: 200 })]],
          ['r2', [LINE({ ingredientId: 'iM', quantity: 2, unit: 'pieces' })]],
        ]),
        ingredientsById: new Map([
          ['iZ', { category: 'produce' }],
          ['iA', { category: 'produce' }],
          ['iM', { category: 'produce' }],
        ]),
      });

    const first = aggregateShoppingList(input());
    const second = aggregateShoppingList(input());
    expect(first.items.map((i) => `${i.ingredientId}|${i.unit}`)).toEqual([
      'iA|g',
      'iM|pieces',
      'iZ|g',
    ]);
    expect(second.items).toEqual(first.items);
  });

  describe('per-day simulation', () => {
    test('a lot that expires mid-week no longer offsets demand from later in the week (the bug this fixes)', () => {
      const input = baseInput({
        entries: [ENTRY({ date: SATURDAY })],
        linesByRecipe: new Map([['r1', [LINE({ quantity: 400 })]]]),
        pantryRows: [ROW({ quantity: 500, expiresDate: WEDNESDAY })],
      });
      const { items } = aggregateShoppingList(input);
      expect(items[0]).toMatchObject({ quantityNeeded: 400, quantityInPantry: 0, netToBuy: 400 });
    });

    test('the same mid-week-expiring stock still fully covers demand dated before it expires', () => {
      const input = baseInput({
        entries: [ENTRY({ date: TODAY })],
        linesByRecipe: new Map([['r1', [LINE({ quantity: 400 })]]]),
        pantryRows: [ROW({ quantity: 500, expiresDate: WEDNESDAY })],
      });
      const { items } = aggregateShoppingList(input);
      expect(items[0]).toMatchObject({ quantityNeeded: 400, quantityInPantry: 400, netToBuy: 0 });
    });

    test('drains a short-dated lot on the first demand day, then falls back to a longer-dated lot on the second', () => {
      const input = baseInput({
        entries: [
          ENTRY({ id: 'e1', recipeId: 'r1', date: TODAY }),
          ENTRY({ id: 'e2', recipeId: 'r2', date: THURSDAY }),
        ],
        recipesById: new Map([
          ['r1', { servings: 4 }],
          ['r2', { servings: 4 }],
        ]),
        linesByRecipe: new Map([
          ['r1', [LINE({ quantity: 200 })]],
          ['r2', [LINE({ quantity: 250 })]],
        ]),
        // Lot A dies the same day it's fully consumed by; lot B outlives the week.
        pantryRows: [ROW({ quantity: 200, expiresDate: TODAY }), ROW({ quantity: 300, expiresDate: FRIDAY })],
      });
      const { items } = aggregateShoppingList(input);
      expect(items[0]).toMatchObject({ quantityNeeded: 450, quantityInPantry: 450, netToBuy: 0 });
    });

    test('a lot already expired as of today is excluded for every date in the week, not just today', () => {
      const input = baseInput({
        entries: [
          ENTRY({ id: 'e1', recipeId: 'r1', date: MONDAY }),
          ENTRY({ id: 'e2', recipeId: 'r2', date: SUNDAY }),
        ],
        recipesById: new Map([
          ['r1', { servings: 4 }],
          ['r2', { servings: 4 }],
        ]),
        linesByRecipe: new Map([
          ['r1', [LINE({ quantity: 100 })]],
          ['r2', [LINE({ quantity: 100 })]],
        ]),
        pantryRows: [
          ROW({ quantity: 1000, expiresDate: '2026-08-01' }), // dead before TODAY
          ROW({ quantity: 150, expiresDate: '2026-08-20' }), // alive all week
        ],
      });
      const { items } = aggregateShoppingList(input);
      expect(items[0]).toMatchObject({ quantityNeeded: 200, quantityInPantry: 150, netToBuy: 50 });
    });

    test('caps quantityInPantry at quantityNeeded across a multi-day week when surplus stock remains uneaten', () => {
      const input = baseInput({
        entries: [
          ENTRY({ id: 'e1', recipeId: 'r1', date: TODAY }),
          ENTRY({ id: 'e2', recipeId: 'r2', date: THURSDAY }),
        ],
        recipesById: new Map([
          ['r1', { servings: 4 }],
          ['r2', { servings: 4 }],
        ]),
        linesByRecipe: new Map([
          ['r1', [LINE({ quantity: 100 })]],
          ['r2', [LINE({ quantity: 100 })]],
        ]),
        pantryRows: [ROW({ quantity: 1000, expiresDate: '2026-12-01' })],
      });
      const { items } = aggregateShoppingList(input);
      expect(items[0]).toMatchObject({ quantityNeeded: 200, quantityInPantry: 200, netToBuy: 0 });
    });

    test('an entry dated before today inside the current week does not resurrect stock that expired between then and now', () => {
      const input = baseInput({
        entries: [ENTRY({ date: MONDAY })],
        linesByRecipe: new Map([['r1', [LINE({ quantity: 400 })]]]),
        // Alive as of MONDAY (its own date), but dead as of TODAY.
        pantryRows: [ROW({ quantity: 100, expiresDate: MONDAY })],
      });
      const { items } = aggregateShoppingList(input);
      expect(items[0]).toMatchObject({ quantityInPantry: 0, netToBuy: 400 });
    });
  });
});
