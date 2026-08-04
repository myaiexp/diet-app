// Recipe reads/writes. Scaling is the API's job — never multiply client-side.

import { apiGet, apiSend } from './client.js';
import type {
  Recipe,
  RecipeWithIngredients,
  RecipeCreate,
  RecipePatch,
} from './types.js';

export interface RecipeQuery {
  /** Comma-joined; the API ANDs them via array containment. */
  tags?: string;
  cuisine?: string;
  limit?: number;
  offset?: number;
}

export function listRecipes(query: RecipeQuery = {}): Promise<Recipe[]> {
  return apiGet<Recipe[]>('/recipes', { ...query });
}

/**
 * `servings` asks the API to scale the ingredient lines exactly
 * (recipe-scale.ts). Reimplementing qty × target / base here would create a
 * second rounding path that disagrees with the deduction a cook actually
 * applies.
 */
export function getRecipe(
  id: string,
  servings?: number,
): Promise<RecipeWithIngredients> {
  return apiGet<RecipeWithIngredients>(
    `/recipes/${id}`,
    servings !== undefined ? { servings } : undefined,
  );
}

export function createRecipe(body: RecipeCreate): Promise<RecipeWithIngredients> {
  return apiSend<RecipeWithIngredients>('POST', '/recipes', body);
}

/**
 * PATCH replaces the ingredient list wholesale — it deletes every
 * recipe_ingredients row and reinserts what you send. Always submit the
 * complete list; sending only changed lines silently deletes the rest.
 */
export function patchRecipe(
  id: string,
  body: RecipePatch,
): Promise<RecipeWithIngredients> {
  return apiSend<RecipeWithIngredients>('PATCH', `/recipes/${id}`, body);
}

export function deleteRecipe(id: string): Promise<void> {
  return apiSend<void>('DELETE', `/recipes/${id}`);
}

/**
 * A fork is a create, not a mutation: a new row carrying parentRecipeId, with
 * the source left untouched. Lines are copied unscaled, from the base recipe.
 */
export function forkRecipe(source: RecipeWithIngredients): Promise<RecipeWithIngredients> {
  const base = source.baseServings ?? source.servings;
  const factor = source.baseServings ? base / source.servings : 1;
  return createRecipe({
    title: `${source.title} (fork)`,
    sourceType: 'forked',
    parentRecipeId: source.id,
    sourceUrl: source.sourceUrl,
    steps: source.steps,
    ...(source.prepTime !== null ? { prepTime: source.prepTime } : {}),
    ...(source.totalTime !== null ? { totalTime: source.totalTime } : {}),
    servings: base,
    ...(source.effortScore !== null ? { effortScore: source.effortScore } : {}),
    tags: source.tags ?? [],
    cuisineType: source.cuisineType,
    ingredients: source.recipeIngredients.map((line) => ({
      ingredientId: line.ingredientId,
      // Undo any view scaling: a fork of a ×1.5 view must not persist ×1.5.
      quantity: Number(line.quantity) * factor,
      unit: line.unit,
      optional: line.optional ?? false,
      notes: line.notes,
    })),
  });
}
