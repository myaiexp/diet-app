// Mock-based route tests for POST /recipes/import — no real AI or network

import { describe, test, expect, vi } from 'vitest';
import { recipeImportRoutes } from '../routes/recipe-import.js';
import { recipesRoutes } from '../routes/recipes.js';
import type { AiConfig } from '../config.js';
import type { ExtractedRecipe } from '../ai/import-recipe.js';
import { IMPORT_TEXT_MAX_CHARS } from '../ai/import-limits.js';
import type { LineMatch } from '../ingredient-match.js';

const AI: AiConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example.com/v1',
  modelCapable: 'capable-model',
};

const EXTRACTED: ExtractedRecipe = {
  title: 'Omelette',
  steps: ['Whisk', 'Cook'],
  servings: 2,
  prepTime: 5,
  totalTime: 10,
  cuisineType: 'french',
  tags: ['quick'],
  effortScore: 1,
  ingredients: [
    { name: 'Egg', quantity: 2, unit: 'kpl' },
    { name: 'Unicorn dust', quantity: 1, unit: 'g', optional: true, notes: 'rare' },
  ],
};

const MATCHES: LineMatch[] = [
  { rawName: 'Egg', ingredientId: '11111111-1111-4111-8111-111111111111', match: 'exact' },
  { rawName: 'Unicorn dust', ingredientId: null, match: 'none' },
];

function makeDb() {
  const insert = vi.fn(() => {
    throw new Error('db.insert must not be called on import');
  });
  const db = {
    insert,
    select: vi.fn(() => {
      throw new Error('db.select must not be called when match is injected');
    }),
    query: {},
    transaction: vi.fn(),
  } as any;
  return { db, insert };
}

function makeApp(opts: {
  ai?: AiConfig | null;
  extractOk?: boolean;
  fetchResult?:
    | { ok: true; text: string; finalUrl: string; truncated: boolean }
    | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };
  matches?: LineMatch[];
  extract?: ReturnType<typeof vi.fn>;
  fetch?: ReturnType<typeof vi.fn>;
  match?: ReturnType<typeof vi.fn>;
} = {}) {
  const { db, insert } = makeDb();
  const extractRecipeFromText =
    opts.extract ??
    vi.fn(async () =>
      opts.extractOk === false
        ? { ok: false as const }
        : { ok: true as const, recipe: EXTRACTED },
    );
  const fetchUrlAsText =
    opts.fetch ??
    vi.fn(async () =>
      opts.fetchResult ?? {
        ok: true as const,
        text: 'fetched recipe page',
        finalUrl: 'https://example.com/recipe',
        truncated: false,
      },
    );
  const matchIngredientNames =
    opts.match ??
    vi.fn(async (_db: unknown, names: string[]) => {
      if (opts.matches) return opts.matches;
      return names.map((rawName, i) => MATCHES[i] ?? {
        rawName,
        ingredientId: null,
        match: 'none' as const,
      });
    });
  const createAiClient = vi.fn(() => ({ mocked: true }) as any);

  const app = recipeImportRoutes(db, {
    ai: opts.ai === undefined ? AI : opts.ai,
    // vi.fn mocks are structural stand-ins for the injectable deps.
    extractRecipeFromText: extractRecipeFromText as any,
    fetchUrlAsText: fetchUrlAsText as any,
    matchIngredientNames: matchIngredientNames as any,
    createAiClient: createAiClient as any,
  });

  return {
    app,
    db,
    insert,
    extractRecipeFromText,
    fetchUrlAsText,
    matchIngredientNames,
    createAiClient,
  };
}

async function postImport(app: { request: (...args: any[]) => any }, body: unknown) {
  return app.request('/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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
        quantity: 1,
        unit: 'g',
        optional: true,
        notes: 'rare',
        match: 'none',
        quantityInferred: false,
      },
    ]);
    expect(body.unmatchedCount).toBe(1);
    // Draft quantity is a number, not a string
    expect(typeof body.draft.ingredients[0].quantity).toBe('number');
  });

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
  });

  test('blocked url returns 400', async () => {
    const { app, extractRecipeFromText } = makeApp({
      fetchResult: { ok: false, error: 'blocked_url' },
    });
    const res = await postImport(app, { url: 'http://127.0.0.1/secret' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or blocked URL' });
    expect(extractRecipeFromText).not.toHaveBeenCalled();
  });

  test('invalid url returns 400', async () => {
    const { app } = makeApp({
      fetchResult: { ok: false, error: 'invalid_url' },
    });
    const res = await postImport(app, { url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or blocked URL' });
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
        { rawName: 'Egg', ingredientId: null, match: 'none' },
        { rawName: 'Unicorn dust', ingredientId: null, match: 'none' },
      ],
    });
    const res = await postImport(app, { text: 'x' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unmatchedCount).toBe(2);
  });

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
          match: 'alias',
        },
        {
          rawName: 'Voita',
          ingredientId: '33333333-3333-4333-8333-333333333333',
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
          match: 'alias',
        },
      ],
    });
    const res = await postImport(app, { text: 'voileipä' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.ingredients[0].quantityInferred).toBe(false);
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
