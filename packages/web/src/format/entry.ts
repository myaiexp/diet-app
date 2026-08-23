// Meal-plan entry titles, status pills, and which statuses still cook.

import type { EntryStatus, MealPlanEntry, Recipe } from '../api/types.js';

export const STATUS_LABEL: Record<EntryStatus, { text: string; cls: string }> = {
  planned: { text: 'planned', cls: 'label' },
  cooked: { text: 'cooked', cls: 'label label-green' },
  skipped: { text: 'skipped', cls: 'label label-red' },
  substituted: { text: 'substituted', cls: 'label label-orange' },
};

/** Still demand — shopping includes it, and POST /cook accepts it. Skipped is a no. */
export function isCookable(status: EntryStatus): boolean {
  return status === 'planned' || status === 'substituted';
}

/**
 * Substitute wins when set — that's the recipe a cook would actually deduct
 * from — with `(recipe)` when the loaded collection doesn't have the id
 * (e.g. deleted after the plan was made) and `(untitled)` when the entry
 * has neither a recipe nor a freeform note.
 */
export function entryTitle(entry: MealPlanEntry, recipesById: Map<string, Recipe>): string {
  const recipeId = entry.substituteRecipeId ?? entry.recipeId;
  if (recipeId) {
    const title = recipesById.get(recipeId)?.title ?? '(recipe)';
    return entry.notes ? `${title} · ${entry.notes}` : title;
  }
  return entry.freeformNote ?? '(untitled)';
}
