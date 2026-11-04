// POST /recipes/import url path: fetch, truncated and lowYield

import { describe, test, expect } from 'vitest';
import { AI, makeApp, postImport } from './recipe-import-test-helpers.js';

describe('POST /recipes/import', () => {
  test('url path uses fetch then extract (mocked)', async () => {
    const { app, extractRecipeFromText, fetchUrlAsText } = makeApp({
      fetchResult: {
        ok: true,
        text: 'page text content',
        finalUrl: 'https://example.com/final',
        truncated: false,
      },
    });
    const res = await postImport(app, { url: 'https://example.com/recipe' });
    expect(res.status).toBe(200);
    expect(fetchUrlAsText).toHaveBeenCalledWith('https://example.com/recipe');
    expect(extractRecipeFromText).toHaveBeenCalledOnce();
    const extractArgs = extractRecipeFromText.mock.calls[0]!;
    expect(extractArgs[1]).toBe(AI.modelCapable);
    expect(extractArgs[2]).toBe('page text content');
    const body = await res.json();
    expect(body.draft.sourceUrl).toBe('https://example.com/final');
    expect(body.draft.sourceType).toBe('imported');
    expect(body.truncated).toBe(false);
  });

  test('url path surfaces truncated:true on the import JSON (finding #8019)', async () => {
    // Fetch still extracts from the partial page — no 4xx — but the client
    // must see the flag so the review screen can warn. Paste oversize stays 400.
    const { app, extractRecipeFromText } = makeApp({
      fetchResult: {
        ok: true,
        text: 'partial page',
        finalUrl: 'https://example.com/long',
        truncated: true,
      },
    });
    const res = await postImport(app, { url: 'https://example.com/long' });
    expect(res.status).toBe(200);
    expect(extractRecipeFromText).toHaveBeenCalledOnce();
    expect(extractRecipeFromText.mock.calls[0]![2]).toBe('partial page');
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.draft.sourceUrl).toBe('https://example.com/long');
  });

  test('url path surfaces lowYield:true on the import JSON (idea #4087)', async () => {
    // A JS-hydrated page answers 200 with a near-empty shell, so nothing in the
    // chain fails. Without this flag the extraction quietly returns near-garbage
    // and the client has no way to say why.
    const { app } = makeApp({
      fetchResult: {
        ok: true,
        text: 'Resepti Enable JavaScript',
        finalUrl: 'https://example.com/spa',
        truncated: false,
        lowYield: true,
      },
    });
    const res = await postImport(app, { url: 'https://example.com/spa' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lowYield).toBe(true);
    expect(body.truncated).toBe(false);
  });

  test('paste path is never low-yield — a short paste is the user’s own input', async () => {
    const { app } = makeApp();
    const res = await postImport(app, { text: 'kaali, suola' });
    expect(res.status).toBe(200);
    expect((await res.json()).lowYield).toBe(false);
  });
});
