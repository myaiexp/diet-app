// A row generate writes must survive a both-fields PATCH of its own numbers.

import { describe, expect, test } from 'vitest';
import {
  aggregateShoppingList,
  type GeneratedItem,
  type PantrySupplyRow,
} from '../shopping-aggregate.js';
import { reconcileItemQuantities } from '../item-quantities.js';

const TODAY = '2026-08-04';

function generate(lineQty: number, lineUnit: string, recipeServings: number, entryServings: number, pantry: PantrySupplyRow[]) {
  const { items } = aggregateShoppingList({
    entries: [
      { id: 'e1', recipeId: 'r1', substituteRecipeId: null, servings: entryServings, status: 'planned', date: TODAY },
    ],
    recipesById: new Map([['r1', { servings: recipeServings }]]),
    linesByRecipe: new Map([['r1', [{ ingredientId: 'i1', quantity: lineQty, unit: lineUnit, optional: false }]]]),
    pantryRows: pantry,
    ingredientsById: new Map([['i1', { category: 'produce' }]]),
    today: TODAY,
  });
  expect(items).toHaveLength(1);
  return items[0]!;
}

/** PATCH { quantityNeeded, netToBuy } copied off the stored row: accepted, and a no-op write. */
function expectRoundTrips(item: GeneratedItem, label: string) {
  const stored = {
    source: 'generated',
    quantityNeeded: String(item.quantityNeeded),
    quantityInPantry: String(item.quantityInPantry),
    netToBuy: String(item.netToBuy),
  };
  const result = reconcileItemQuantities(stored, {
    quantityNeeded: item.quantityNeeded,
    netToBuy: item.netToBuy,
  });
  expect(result, label).toEqual({
    ok: true,
    write: {
      quantityNeeded: stored.quantityNeeded,
      quantityInPantry: stored.quantityInPantry,
      netToBuy: stored.netToBuy,
      quantityEdited: false,
    },
  });
}

describe('generated shopping items round-trip through PATCH', () => {
  // Finding #12884: 1/3 kg with half of it in the pantry rounds to
  // 333.333333 / 166.666667 / 166.666667 if each field is rounded on its own,
  // and 166.666667 + 166.666667 is 333.333334 — the PATCH identity rejects it.
  test('a fractional kg line with partial pantry coverage', () => {
    const item = generate(1 / 3, 'kg', 4, 4, [
      { ingredientId: 'i1', quantity: 1 / 6, unit: 'kg', expiresDate: '2026-08-10' },
    ]);
    expect(item.quantityNeeded).toBe(333.333333);
    expect(item.quantityInPantry).toBe(166.666667);
    expect(item.netToBuy).toBe(166.666666);
    expectRoundTrips(item, '1/3 kg');
  });

  // Rule, not one example: fractional demand from servings scaling against
  // fractional coverage, in every dimension, always round-trips.
  test('holds for fractional demand and coverage in every dimension', () => {
    let seed = 0x12884;
    const next = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const units = ['kg', 'g', 'tsp', 'dl', 'ml', 'pcs'];

    for (let i = 0; i < 300; i++) {
      const unit = units[i % units.length]!;
      const lineQty = 0.01 + next() * 3;
      const recipeServings = 1 + Math.floor(next() * 7);
      const entryServings = 1 + Math.floor(next() * 12);
      const pantry: PantrySupplyRow[] =
        i % 4 === 0
          ? []
          : [{ ingredientId: 'i1', quantity: next() * lineQty * 3, unit, expiresDate: '2026-08-10' }];
      const item = generate(lineQty, unit, recipeServings, entryServings, pantry);
      expectRoundTrips(item, `case ${i}: ${lineQty} ${unit} ${entryServings}/${recipeServings}`);
    }
  });
});
