// POST /recipes/import: validation, text path and route mounting

import { describe, test, expect } from 'vitest';
import { recipesRoutes } from '../routes/recipes.js';
import { IMPORT_TEXT_MAX_CHARS } from '../ai/import-limits.js';
import { makeApp, makeDb, postImport } from './recipe-import-test-helpers.js';

describe('POST /recipes/import', () => {
  test('503 when ai config null', async () => {
    const { app, extractRecipeFromText } = makeApp({ ai: null });
    const res = await postImport(app, { text: 'some recipe' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'AI not configured' });
    expect(extractRecipeFromText).not.toHaveBeenCalled();
  });

  test('400 when both url and text', async () => {
    const { app } = makeApp();
    const res = await postImport(app, {
      url: 'https://example.com/r',
      text: 'paste',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  test('400 when neither url nor text', async () => {
    const { app } = makeApp();
    const res = await postImport(app, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  test('400 when text exceeds max chars', async () => {
    const { app, extractRecipeFromText } = makeApp();
    const res = await postImport(app, {
      text: 'x'.repeat(IMPORT_TEXT_MAX_CHARS + 1),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(extractRecipeFromText).not.toHaveBeenCalled();
  });

  test('text path returns draft with matched and unmatched lines', async () => {
    const { app, extractRecipeFromText, fetchUrlAsText, matchIngredientNames } =
      makeApp();
    const res = await postImport(app, { text: 'omelette recipe text' });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(fetchUrlAsText).not.toHaveBeenCalled();
    expect(extractRecipeFromText).toHaveBeenCalledOnce();
    expect(matchIngredientNames).toHaveBeenCalledOnce();

    expect(body.draft.title).toBe('Omelette');
    expect(body.draft.sourceType).toBe('imported');
    expect(body.draft.sourceUrl).toBeNull();
    expect(body.draft.steps).toEqual(['Whisk', 'Cook']);
    expect(body.draft.servings).toBe(2);
    expect(body.draft.ingredients).toEqual([
      {
        rawName: 'Egg',
        ingredientId: '11111111-1111-4111-8111-111111111111',
        // The catalog name rides along with the id so the review screen can
        // name the match instead of showing a generic label (#3237).
        ingredientName: 'Egg',
        quantity: 2,
        unit: 'kpl',
        optional: false,
        notes: null,
        match: 'exact',
        quantityInferred: false,
      },
      {
        rawName: 'Unicorn dust',
        ingredientId: null,
        ingredientName: null,
        quantity: 1,
        unit: 'g',
        optional: true,
        notes: 'rare',
        match: 'none',
        quantityInferred: false,
      },
    ]);
    expect(body.unmatchedCount).toBe(1);
    // Paste never truncates — oversize text is 400 at the schema.
    expect(body.truncated).toBe(false);
    // Draft quantity is a number, not a string
    expect(typeof body.draft.ingredients[0].quantity).toBe('number');
  });

  test('an ambiguous line counts as unmatched, since nothing is bound yet', async () => {
    const { app } = makeApp({
      matches: [
        { rawName: 'Egg', ingredientId: null, ingredientName: null, match: 'ambiguous' },
        { rawName: 'Unicorn dust', ingredientId: null, ingredientName: null, match: 'none' },
      ],
    });
    const res = await app.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Omelette: whisk eggs, cook.' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).unmatchedCount).toBe(2);
  });

  test('recipesRoutes mounts POST /import before /:id (503 without AI)', async () => {
    const { db } = makeDb();
    const app = recipesRoutes(db, { ai: null });
    const res = await app.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x' }),
    });
    expect(res.status).toBe(503);
    // Malformed UUID path still hits :id validation, not import.
    const badId = await app.request('/not-a-uuid');
    expect(badId.status).toBe(400);
  });
});
