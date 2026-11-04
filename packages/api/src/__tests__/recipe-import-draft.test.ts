// POST /recipes/import draft shaping: defaults and inferred quantities

import { describe, test, expect, vi } from 'vitest';
import type { ExtractedRecipe } from '../ai/import-recipe.js';
import { makeApp, postImport } from './recipe-import-test-helpers.js';

describe('POST /recipes/import', () => {
  test('applies defaults when model omits optional fields', async () => {
    const minimal: ExtractedRecipe = {
      title: 'Plain',
      steps: [],
      ingredients: [{ name: 'Water', quantity: 1, unit: 'cup' }],
    };
    const { app } = makeApp({
      extract: vi.fn(async () => ({ ok: true as const, recipe: minimal })),
      matches: [
        {
          rawName: 'Water',
          ingredientId: null,
          ingredientName: null,
          match: 'none',
        },
      ],
    });
    const res = await postImport(app, { text: 'water' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.steps).toEqual([]);
    expect(body.draft.servings).toBe(1);
    expect(body.draft.tags).toEqual([]);
    expect(body.draft.prepTime).toBeNull();
    expect(body.draft.totalTime).toBeNull();
    expect(body.draft.effortScore).toBeNull();
    expect(body.draft.cuisineType).toBeNull();
  });

  test('passes an inferred-quantity flag through to the draft line', async () => {
    // "1 iso sipuli" — matched a catalog ingredient, but 150 g is the model's
    // invention. The review screen shows these as `assumed`, saveable but flagged.
    const guessed: ExtractedRecipe = {
      title: 'Sipulikeitto',
      steps: [],
      ingredients: [
        { name: 'Sipuli', quantity: 150, unit: 'g', quantityInferred: true },
        { name: 'Voita', quantity: 40, unit: 'g', quantityInferred: false },
      ],
    };
    const { app } = makeApp({
      extract: vi.fn(async () => ({ ok: true as const, recipe: guessed })),
      matches: [
        {
          rawName: 'Sipuli',
          ingredientId: '22222222-2222-4222-8222-222222222222',
          ingredientName: 'Onion',
          match: 'alias',
        },
        {
          rawName: 'Voita',
          ingredientId: '33333333-3333-4333-8333-333333333333',
          ingredientName: 'Butter',
          match: 'alias',
        },
      ],
    });
    const res = await postImport(app, { text: 'sipulikeitto' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.ingredients[0].quantityInferred).toBe(true);
    expect(body.draft.ingredients[1].quantityInferred).toBe(false);
    // An assumed line is still bound — it does not count as unmatched.
    expect(body.unmatchedCount).toBe(0);
  });

  test('defaults the flag to false when the model omits it', async () => {
    const undecorated: ExtractedRecipe = {
      title: 'Voileipä',
      steps: [],
      ingredients: [{ name: 'Voita', quantity: 40, unit: 'g' }],
    };
    const { app } = makeApp({
      extract: vi.fn(async () => ({ ok: true as const, recipe: undecorated })),
      matches: [
        {
          rawName: 'Voita',
          ingredientId: '33333333-3333-4333-8333-333333333333',
          ingredientName: 'Butter',
          match: 'alias',
        },
      ],
    });
    const res = await postImport(app, { text: 'voileipä' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.ingredients[0].quantityInferred).toBe(false);
  });
});
