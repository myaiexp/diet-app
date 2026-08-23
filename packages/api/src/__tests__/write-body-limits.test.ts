// Write-body Zod caps: string/array length, http(s) URLs, known-key JSONB

import { describe, test, expect } from 'vitest';
import { recipeCreateSchema, recipePatchSchema } from '../schemas/recipes.js';
import { profilePatchSchema } from '../schemas/profile.js';
import { recipeImportBodySchema } from '../schemas/recipe-import.js';
import {
  mealPlanCreateSchema,
  feedbackCreateSchema,
} from '../schemas/meal-plans.js';
import { pantryCreateSchema } from '../schemas/pantry.js';
import { itemCreateSchema, completeSchema } from '../schemas/shopping-lists.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const LINE = { ingredientId: UUID, quantity: 1, unit: 'g' };
const RECIPE = { title: 'Soup', ingredients: [LINE] };

function over(n: number): string {
  return 'a'.repeat(n + 1);
}
function at(n: number): string {
  return 'a'.repeat(n);
}

describe('recipe write bodies', () => {
  test.each([
    ['title over 200', { title: over(200) }],
    ['javascript: sourceUrl', { sourceUrl: 'javascript:alert(1)' }],
    ['data: sourceUrl', { sourceUrl: 'data:text/html,hi' }],
    ['ftp sourceUrl', { sourceUrl: 'ftp://example.com/r' }],
    ['relative sourceUrl', { sourceUrl: '/recipes/1' }],
    ['sourceUrl over 2048', { sourceUrl: `https://example.com/${over(2048)}` }],
    ['81 steps', { steps: Array.from({ length: 81 }, () => 'mix') }],
    ['step over 4000', { steps: [over(4000)] }],
    ['blank step', { steps: ['  '] }],
    ['41 tags', { tags: Array.from({ length: 41 }, () => 'tag') }],
    ['tag over 50', { tags: [over(50)] }],
    ['cuisine over 200', { cuisineType: over(200) }],
    ['unit over 32', { ingredients: [{ ...LINE, unit: over(32) }] }],
    ['notes over 4000', { ingredients: [{ ...LINE, notes: over(4000) }] }],
    ['81 ingredient lines', { ingredients: Array.from({ length: 81 }, () => LINE) }],
  ])('create rejects %s', (_name, extra) => {
    expect(recipeCreateSchema.safeParse({ ...RECIPE, ...extra }).success).toBe(false);
  });

  test.each([
    ['200-char title', { title: at(200) }],
    ['https sourceUrl', { sourceUrl: 'https://example.com/r' }],
    ['http sourceUrl', { sourceUrl: 'http://example.com/r' }],
    ['null sourceUrl', { sourceUrl: null }],
    ['80 steps of 4000', { steps: Array.from({ length: 80 }, () => at(4000)) }],
    ['40 tags of 50', { tags: Array.from({ length: 40 }, () => at(50)) }],
    ['80 ingredient lines', { ingredients: Array.from({ length: 80 }, () => LINE) }],
  ])('create accepts %s', (_name, extra) => {
    expect(recipeCreateSchema.safeParse({ ...RECIPE, ...extra }).success).toBe(true);
  });

  test('patch rejects javascript: sourceUrl', () => {
    expect(recipePatchSchema.safeParse({ sourceUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  test('patch accepts null sourceUrl (clear)', () => {
    expect(recipePatchSchema.safeParse({ sourceUrl: null }).success).toBe(true);
  });

  test('patch rejects an empty ingredients replace', () => {
    expect(recipePatchSchema.safeParse({ ingredients: [] }).success).toBe(false);
  });
});

describe('profile PATCH body', () => {
  test.each([
    ['name over 100', { name: over(100) }],
    ['51 dietaryRestrictions', { dietaryRestrictions: Array.from({ length: 51 }, () => 'x') }],
    ['restriction over 80', { dietaryRestrictions: [over(80)] }],
    ['51 kitchenEquipment', { kitchenEquipment: Array.from({ length: 51 }, () => 'x') }],
    ['equipment over 80', { kitchenEquipment: [over(80)] }],
    ['201 disliked ids', { dislikedIngredientIds: Array.from({ length: 201 }, () => UUID) }],
    ['macroTargets string', { macroTargets: 'nope' }],
    ['macroTargets nested', { macroTargets: { protein: { n: 1 } } }],
    ['macro grams over 10000', { macroTargets: { protein: 10001 } }],
    ['negative macro', { macroTargets: { fat: -1 } }],
    ['scheduleProfile string', { scheduleProfile: 'late shift' }],
    ['schedule note over 500', { scheduleProfile: { note: over(500) } }],
  ])('rejects %s', (_name, extra) => {
    expect(profilePatchSchema.safeParse(extra).success).toBe(false);
  });

  test('accepts known-key macros and strips extras', () => {
    const parsed = profilePatchSchema.safeParse({
      macroTargets: { protein: 130, carbs: 230, fat: 80, extra: 1 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.macroTargets).toEqual({ protein: 130, carbs: 230, fat: 80 });
  });

  test('accepts scheduleProfile.note and strips extras', () => {
    const parsed = profilePatchSchema.safeParse({
      scheduleProfile: { note: 'late shift', extra: { deep: 'x'.repeat(100) } },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.scheduleProfile).toEqual({ note: 'late shift' });
  });

  test('accepts null macroTargets (clear)', () => {
    expect(profilePatchSchema.safeParse({ macroTargets: null }).success).toBe(true);
  });
});

describe('recipe import body', () => {
  test('rejects javascript: url at the schema', () => {
    expect(recipeImportBodySchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  test('rejects a non-URL string at the schema', () => {
    expect(recipeImportBodySchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
  });

  test('accepts an http(s) url', () => {
    expect(recipeImportBodySchema.safeParse({ url: 'https://example.com/r' }).success).toBe(
      true,
    );
  });
});

describe('other write-body free text', () => {
  test('meal-plan freeformNote over 4000 is rejected', () => {
    expect(
      mealPlanCreateSchema.safeParse({
        date: '2026-07-21',
        slot: 'dinner',
        freeformNote: over(4000),
      }).success,
    ).toBe(false);
  });

  test('meal-plan notes over 4000 is rejected', () => {
    expect(
      mealPlanCreateSchema.safeParse({
        date: '2026-07-21',
        slot: 'dinner',
        recipeId: UUID,
        notes: over(4000),
      }).success,
    ).toBe(false);
  });

  test('feedback changesNote over 4000 is rejected', () => {
    expect(
      feedbackCreateSchema.safeParse({
        rating: 'thumbs_up',
        effortCheck: 'felt_right',
        makeAgain: 'yes',
        usedAsIs: false,
        changesNote: over(4000),
      }).success,
    ).toBe(false);
  });

  test('pantry unit over 32 is rejected', () => {
    expect(
      pantryCreateSchema.safeParse({
        ingredientId: UUID,
        quantity: 1,
        unit: over(32),
        location: 'fridge',
      }).success,
    ).toBe(false);
  });

  test('shopping customNote over 4000 is rejected', () => {
    expect(
      itemCreateSchema.safeParse({
        ingredientId: UUID,
        quantityNeeded: 1,
        unit: 'g',
        customNote: over(4000),
      }).success,
    ).toBe(false);
  });

  test('complete overrides over 200 is rejected', () => {
    expect(
      completeSchema.safeParse({
        overrides: Array.from({ length: 201 }, () => ({ itemId: UUID, location: 'fridge' })),
      }).success,
    ).toBe(false);
  });
});
