// Unit tests for the table-driven PATCH payload builder.

import { describe, test, expect } from 'vitest';
import { recipes, pantryItems, mealPlanEntries } from '@diet-app/db';
import { buildPatch } from '../patch-builder.js';

describe('buildPatch', () => {
  test('copies defined fields that name a column', () => {
    const patch = buildPatch({ title: 'Soup', servings: 4 }, recipes);
    expect(patch).toEqual({ title: 'Soup', servings: 4 });
  });

  test('skips undefined fields (omitted from the request body)', () => {
    const patch = buildPatch({ title: 'Soup', cuisineType: undefined }, recipes);
    expect(patch).toEqual({ title: 'Soup' });
    expect('cuisineType' in patch).toBe(false);
  });

  test('keeps explicit null so a nullable column can be cleared', () => {
    const patch = buildPatch({ cuisineType: null }, recipes);
    expect(patch).toEqual({ cuisineType: null });
  });

  test('skips patch fields that are not columns of the table', () => {
    const patch = buildPatch(
      { title: 'Soup', ingredients: [{ ingredientId: 'x', quantity: 1, unit: 'g' }] },
      recipes,
    );
    expect(patch).toEqual({ title: 'Soup' });
  });

  test('omit leaves a column for the route to write itself', () => {
    const patch = buildPatch({ quantity: 2, unit: 'kg' }, pantryItems, ['unit']);
    expect(patch).toEqual({ quantity: '2' });
  });

  test('stringifies a number bound for a numeric column', () => {
    // Drizzle types numeric columns as strings; Zod hands the route a number.
    const patch = buildPatch({ quantity: 1.5, unit: 'kg' }, pantryItems);
    expect(patch).toEqual({ quantity: '1.5', unit: 'kg' });
    const text: string | undefined = patch.quantity;
    expect(text).toBe('1.5');
  });

  test('leaves integer columns as numbers', () => {
    expect(buildPatch({ servings: 4 }, recipes)).toEqual({ servings: 4 });
  });

  test('passes null through to a nullable numeric column', () => {
    expect(buildPatch({ actualServings: null }, mealPlanEntries)).toEqual({ actualServings: null });
  });

  test('does not invent updatedAt — the route stamps it', () => {
    const patch = buildPatch({ title: 'Soup' }, recipes);
    expect('updatedAt' in patch).toBe(false);
  });

  test('an empty patch yields an empty object', () => {
    expect(buildPatch({}, recipes)).toEqual({});
  });

  test('picks up a new schema field automatically once it names a column', () => {
    // The failure this guards: with hand-written `if (x !== undefined)` lines, a
    // field added to the Zod schema is silently dropped until someone adds a line.
    const patch = buildPatch({ userRating: 5 }, recipes);
    expect(patch).toEqual({ userRating: 5 });
  });
});
