// Recipe import: AI draft extraction (never inserts) + the confirming create

import { apiSend } from './client.js';
import { createRecipe } from './recipes.js';
import type { RecipeImportResponse, RecipeCreate, RecipeWithIngredients } from './types.js';

/**
 * fetch-url caps at 10s and the AI client at 30s; a default 25s browser bound
 * would abort a draft that's still going to land. Slack covers matching after.
 */
export const IMPORT_TIMEOUT_MS = 45_000;

export interface ImportInput {
  /** Exactly one of url / text — sending both is a 400. */
  url?: string;
  text?: string;
}

/**
 * Draft only. The API's import route never inserts: the recipe exists once the
 * user confirms the reconciled draft through `confirmRecipe`.
 */
export function extractDraft(input: ImportInput): Promise<RecipeImportResponse> {
  return apiSend<RecipeImportResponse>('POST', '/recipes/import', input, {
    timeoutMs: IMPORT_TIMEOUT_MS,
  });
}

/** Every line needs a real ingredientId, and at least one line must survive. */
export function confirmRecipe(body: RecipeCreate): Promise<RecipeWithIngredients> {
  return createRecipe(body);
}
