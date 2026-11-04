// Shopping aggregation: input immutability, ordering, per-day simulation

import { describe, test, expect } from 'vitest';
import {
  aggregateShoppingList,
  type PlanEntry,
  type AggregateRecipeLine,
  type PantrySupplyRow,
} from '../shopping-aggregate.js';
import {
  TODAY,
  MONDAY,
  WEDNESDAY,
  THURSDAY,
  FRIDAY,
  SATURDAY,
  SUNDAY,
  ENTRY,
  LINE,
  ROW,
  baseInput,
} from './shopping-aggregate-test-helpers.js';

describe('aggregateShoppingList', () => {
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
