// Unit tests for pure scaleRecipeView helper

import { describe, test, expect } from 'vitest';
import { scaleRecipeView, type RecipeWithIngredients } from '../recipe-scale.js';

const BASE: RecipeWithIngredients = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  title: 'Test',
  servings: 2,
  recipeIngredients: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      recipeId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ingredientId: '22222222-2222-4222-8222-222222222222',
      quantity: '500',
      unit: 'g',
      optional: false,
      notes: null,
      ingredient: { id: '22222222-2222-4222-8222-222222222222', name: 'Chicken' },
    },
  ],
};

describe('scaleRecipeView', () => {
  test('scaleRecipeView doubles quantities when target is 2x base', () => {
    const result = scaleRecipeView(BASE, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.servings).toBe(4);
    expect(result.recipe.baseServings).toBe(2);
    expect(result.recipe.recipeIngredients[0].quantity).toBe('1000');
  });

  test('scaleRecipeView returns string quantities', () => {
    const result = scaleRecipeView(BASE, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.recipe.recipeIngredients[0].quantity).toBe('string');
    expect(result.recipe.recipeIngredients[0].quantity).toBe('250');
  });

  test('scaleRecipeView does not mutate input', () => {
    const copy = structuredClone(BASE);
    scaleRecipeView(BASE, 4);
    expect(BASE).toEqual(copy);
  });

  test('scaleRecipeView invalid_target for 0 / NaN / negative', () => {
    expect(scaleRecipeView(BASE, 0)).toEqual({ ok: false, error: 'invalid_target' });
    expect(scaleRecipeView(BASE, NaN)).toEqual({ ok: false, error: 'invalid_target' });
    expect(scaleRecipeView(BASE, -1)).toEqual({ ok: false, error: 'invalid_target' });
  });

  test('scaleRecipeView invalid_target for 13 / 1e9 / 0.5', () => {
    expect(scaleRecipeView(BASE, 13)).toEqual({ ok: false, error: 'invalid_target' });
    expect(scaleRecipeView(BASE, 1e9)).toEqual({ ok: false, error: 'invalid_target' });
    expect(scaleRecipeView(BASE, 0.5)).toEqual({ ok: false, error: 'invalid_target' });
  });

  test('scaleRecipeView accepts 12', () => {
    const result = scaleRecipeView(BASE, 12);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.servings).toBe(12);
    expect(result.recipe.recipeIngredients[0].quantity).toBe('3000');
  });

  test('scaleRecipeView invalid_base when recipe.servings is 0', () => {
    expect(scaleRecipeView({ ...BASE, servings: 0 }, 2)).toEqual({
      ok: false,
      error: 'invalid_base',
    });
  });
});
