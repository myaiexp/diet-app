// Shared fixtures, db stub and app factory for the recipe-import route suites.

import { vi } from 'vitest';
import { recipeImportRoutes } from '../routes/recipe-import.js';
import type { AiConfig } from '../config.js';
import type { ExtractedRecipe } from '../ai/import-recipe.js';
import type { LineMatch } from '../ingredient-match.js';

export const AI: AiConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example.com/v1',
  modelCapable: 'capable-model',
};

export const EXTRACTED: ExtractedRecipe = {
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

export const MATCHES: LineMatch[] = [
  {
    rawName: 'Egg',
    ingredientId: '11111111-1111-4111-8111-111111111111',
    ingredientName: 'Egg',
    match: 'exact',
  },
  { rawName: 'Unicorn dust', ingredientId: null, ingredientName: null, match: 'none' },
];

export function makeDb() {
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

export function makeApp(opts: {
  ai?: AiConfig | null;
  extractOk?: boolean;
  fetchResult?:
    | { ok: true; text: string; finalUrl: string; truncated: boolean; lowYield?: boolean }
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
        lowYield: false,
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

export async function postImport(app: { request: (...args: any[]) => any }, body: unknown) {
  return app.request('/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
