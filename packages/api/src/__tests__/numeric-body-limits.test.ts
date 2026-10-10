// Write-body numeric caps: int4 columns and numeric quantities 400, never a DB 22003

import { describe, test, expect } from 'vitest';
import { recipeCreateSchema, recipePatchSchema } from '../schemas/recipes.js';
import { profilePatchSchema } from '../schemas/profile.js';
import { pantryCreateSchema, pantryPatchSchema } from '../schemas/pantry.js';
import { itemCreateSchema, itemPatchSchema } from '../schemas/shopping-lists.js';
import { LIMITS } from '../schemas/fields.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const LINE = { ingredientId: UUID, quantity: 1, unit: 'g' };
const RECIPE = { title: 'Soup', ingredients: [LINE] };
const INT4_MAX = 2_147_483_647;

// Every cap must sit inside the column it guards, or the cap is not the gate.
test('integer caps fit PostgreSQL int4', () => {
  for (const cap of [LIMITS.minutes, LIMITS.calories, LIMITS.householdSize]) {
    expect(cap).toBeLessThanOrEqual(INT4_MAX);
  }
});

const HUGE = [INT4_MAX + 1, 9_999_999_999_999];

describe('recipe prepTime / totalTime', () => {
  test.each(['prepTime', 'totalTime'])('%s rejects past the minutes cap', (field) => {
    for (const v of [LIMITS.minutes + 1, ...HUGE]) {
      expect(recipeCreateSchema.safeParse({ ...RECIPE, [field]: v }).success, `${v}`).toBe(false);
      expect(recipePatchSchema.safeParse({ [field]: v }).success, `${v}`).toBe(false);
    }
  });

  test.each(['prepTime', 'totalTime'])('%s accepts 0 and the cap', (field) => {
    for (const v of [0, LIMITS.minutes]) {
      expect(recipeCreateSchema.safeParse({ ...RECIPE, [field]: v }).success).toBe(true);
    }
  });
});

describe('profile integers', () => {
  test.each([
    ['calorieTargetMin', LIMITS.calories + 1],
    ['calorieTargetMax', LIMITS.calories + 1],
    ['householdSize', LIMITS.householdSize + 1],
    ...HUGE.flatMap((v) => [
      ['calorieTargetMin', v],
      ['calorieTargetMax', v],
      ['householdSize', v],
    ]),
  ] as [string, number][])('rejects %s=%s', (field, v) => {
    expect(profilePatchSchema.safeParse({ [field]: v }).success).toBe(false);
  });

  test.each([
    ['calorieTargetMax', LIMITS.calories],
    ['householdSize', LIMITS.householdSize],
  ] as [string, number][])('accepts %s=%s', (field, v) => {
    expect(profilePatchSchema.safeParse({ [field]: v }).success).toBe(true);
  });
});

describe('quantities', () => {
  const tooBig = [LIMITS.quantity + 1, 1e308, '1e308'];

  test.each(tooBig)('recipe line rejects quantity=%s', (quantity) => {
    expect(
      recipeCreateSchema.safeParse({ ...RECIPE, ingredients: [{ ...LINE, quantity }] }).success,
    ).toBe(false);
  });

  test.each(tooBig)('pantry rejects quantity=%s', (quantity) => {
    const base = { ingredientId: UUID, unit: 'g', location: 'fridge' };
    expect(pantryCreateSchema.safeParse({ ...base, quantity }).success).toBe(false);
    expect(pantryPatchSchema.safeParse({ quantity }).success).toBe(false);
  });

  test.each(tooBig)('shopping item rejects quantity=%s', (q) => {
    expect(
      itemCreateSchema.safeParse({ ingredientId: UUID, unit: 'g', quantityNeeded: q }).success,
    ).toBe(false);
    expect(itemPatchSchema.safeParse({ quantityNeeded: q }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ netToBuy: q }).success).toBe(false);
  });

  test('accepts a quantity at the cap', () => {
    expect(
      recipeCreateSchema.safeParse({
        ...RECIPE,
        ingredients: [{ ...LINE, quantity: LIMITS.quantity }],
      }).success,
    ).toBe(true);
    expect(itemPatchSchema.safeParse({ netToBuy: LIMITS.quantity }).success).toBe(true);
  });
});
