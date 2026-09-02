// POST /import — AI extract recipe draft (never inserts)

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import type { AiConfig } from '../config.js';
import { parseJsonBody } from '../json-body.js';
import { badRequest, badGateway, serviceUnavailable } from '../responses.js';
import { recipeImportBodySchema } from '../schemas/recipe-import.js';
import { fetchUrlAsText } from '../ai/fetch-url.js';
import { createAiClient } from '../ai/client.js';
import {
  extractRecipeFromText,
  type ExtractedRecipe,
} from '../ai/import-recipe.js';
import {
  matchIngredientNames,
  type LineMatch,
} from '../ingredient-match.js';

export type RecipeImportRoutesOpts = {
  ai: AiConfig | null;
  fetchUrlAsText?: typeof fetchUrlAsText;
  extractRecipeFromText?: typeof extractRecipeFromText;
  createAiClient?: typeof createAiClient;
  matchIngredientNames?: typeof matchIngredientNames;
};

function buildDraft(
  recipe: ExtractedRecipe,
  matches: LineMatch[],
  sourceUrl: string | null,
) {
  const ingredients = recipe.ingredients.map((ing, i) => {
    const m = matches[i] ?? {
      rawName: ing.name,
      ingredientId: null,
      ingredientName: null,
      match: 'none' as const,
    };
    return {
      rawName: ing.name,
      ingredientId: m.ingredientId,
      // The review screen shows this instead of a generic "catalog match" —
      // reviewing a binding you cannot see is the point of that screen (#3237).
      ingredientName: m.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      optional: ing.optional ?? false,
      notes: ing.notes ?? null,
      match: m.match,
      // The review screen's third state: matched, but the amount was guessed.
      // `match` only carries exact|alias|none, and a round number is not
      // evidence of a guess — only the extraction model knows.
      quantityInferred: ing.quantityInferred ?? false,
    };
  });

  return {
    title: recipe.title,
    sourceType: 'imported' as const,
    sourceUrl,
    steps: recipe.steps ?? [],
    servings: recipe.servings ?? 1,
    prepTime: recipe.prepTime ?? null,
    totalTime: recipe.totalTime ?? null,
    effortScore: recipe.effortScore ?? null,
    tags: recipe.tags ?? [],
    cuisineType: recipe.cuisineType ?? null,
    ingredients,
  };
}

export function recipeImportRoutes(db: Db, opts: RecipeImportRoutesOpts): Hono {
  const app = new Hono();
  const doFetch = opts.fetchUrlAsText ?? fetchUrlAsText;
  const doExtract = opts.extractRecipeFromText ?? extractRecipeFromText;
  const doCreateClient = opts.createAiClient ?? createAiClient;
  const doMatch = opts.matchIngredientNames ?? matchIngredientNames;

  app.post('/import', async (c) => {
    if (!opts.ai) {
      return serviceUnavailable(c, 'AI not configured');
    }

    const parsed = await parseJsonBody(c, recipeImportBodySchema);
    if (!parsed.ok) return parsed.response;

    let text: string;
    let sourceUrl: string | null = null;
    // Paste is rejected over IMPORT_TEXT_MAX_CHARS (400). URL fetch truncates
    // instead — the caller cannot control page size — and that flag must
    // reach the client so the review screen can warn (finding #8019).
    let truncated = false;

    if (parsed.data.url !== undefined) {
      const fetched = await doFetch(parsed.data.url);
      if (!fetched.ok) {
        if (fetched.error === 'fetch_failed') {
          return badGateway(c, 'Failed to fetch URL');
        }
        return badRequest(c, 'Invalid or blocked URL');
      }
      text = fetched.text;
      sourceUrl = fetched.finalUrl;
      truncated = fetched.truncated;
    } else {
      // XOR schema guarantees text is present when url is absent
      text = parsed.data.text!;
    }

    const client = doCreateClient(opts.ai);
    const extracted = await doExtract(client, opts.ai.modelCapable, text);
    if (!extracted.ok) {
      return badGateway(c, 'Recipe extraction failed');
    }

    const names = extracted.recipe.ingredients.map((i) => i.name);
    const matches = await doMatch(db, names);
    const draft = buildDraft(extracted.recipe, matches, sourceUrl);
    const unmatchedCount = draft.ingredients.filter((l) => l.match === 'none').length;

    return c.json({ draft, unmatchedCount, truncated });
  });

  return app;
}
