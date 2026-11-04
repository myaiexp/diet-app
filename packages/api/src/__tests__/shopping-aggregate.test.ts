// Shopping aggregation: plan-entry demand, scaling, units, optional lines

import { describe, test, expect } from 'vitest';
import { aggregateShoppingList } from '../shopping-aggregate.js';
import { ENTRY, LINE, ROW, baseInput } from './shopping-aggregate-test-helpers.js';

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
});
