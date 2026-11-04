// Shopping aggregation: pantry netting, unresolvable units, error reporting

import { describe, test, expect } from 'vitest';
import { aggregateShoppingList } from '../shopping-aggregate.js';
import { TODAY, ENTRY, LINE, ROW, baseInput } from './shopping-aggregate-test-helpers.js';

describe('aggregateShoppingList', () => {
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

  test('reports a negative recipe base as bad_scale', () => {
    const input = baseInput({
      recipesById: new Map([['r1', { servings: -2 }]]),
    });
    const { items, skipped } = aggregateShoppingList(input);
    expect(items).toEqual([]);
    expect(skipped).toEqual([{ ingredientId: null, entryId: 'e1', reason: 'bad_scale' }]);
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
});
