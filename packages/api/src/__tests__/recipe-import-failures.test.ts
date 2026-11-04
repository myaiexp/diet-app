// POST /recipes/import error mappings and the no-write guarantee

import { describe, test, expect } from 'vitest';
import { makeApp, postImport } from './recipe-import-test-helpers.js';

describe('POST /recipes/import', () => {
  test('blocked url returns 400', async () => {
    const { app, extractRecipeFromText } = makeApp({
      fetchResult: { ok: false, error: 'blocked_url' },
    });
    const res = await postImport(app, { url: 'http://127.0.0.1/secret' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or blocked URL' });
    expect(extractRecipeFromText).not.toHaveBeenCalled();
  });

  test('invalid url returns 400 at the schema', async () => {
    const { app, extractRecipeFromText } = makeApp();
    const res = await postImport(app, { url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(extractRecipeFromText).not.toHaveBeenCalled();
  });

  test('fetch_failed returns 502', async () => {
    const { app, extractRecipeFromText } = makeApp({
      fetchResult: { ok: false, error: 'fetch_failed' },
    });
    const res = await postImport(app, { url: 'https://example.com/down' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch URL' });
    expect(extractRecipeFromText).not.toHaveBeenCalled();
  });

  test('extract failure returns 502', async () => {
    const { app } = makeApp({ extractOk: false });
    const res = await postImport(app, { text: 'garbage' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Recipe extraction failed' });
  });

  test('does not call db insert for recipes', async () => {
    const { app, insert, db } = makeApp();
    const res = await postImport(app, { text: 'omelette' });
    expect(res.status).toBe(200);
    expect(insert).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  test('unmatchedCount counts none matches', async () => {
    const { app } = makeApp({
      matches: [
        { rawName: 'Egg', ingredientId: null, ingredientName: null, match: 'none' },
        { rawName: 'Unicorn dust', ingredientId: null, ingredientName: null, match: 'none' },
      ],
    });
    const res = await postImport(app, { text: 'x' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unmatchedCount).toBe(2);
  });
});
