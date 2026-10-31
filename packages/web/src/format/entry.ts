// Meal-plan entry titles, servings label, status pills, which statuses still cook, and slot grouping.

import type { EntryStatus, MealPlanEntry, Recipe, Slot } from '../api/types.js';
import { toNumber } from './quantity.js';

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
 * A slot holds zero or more entries: `(date, slot)` is deliberately not unique,
 * since several snacks a day are normal. Every screen that lays entries out by
 * slot groups through here so none keeps only the last one and hides a meal
 * that shopping and cook still act on. Order within a slot is `entries` order.
 */
export function groupBySlot(entries: MealPlanEntry[]): Map<Slot, MealPlanEntry[]> {
  const bySlot = new Map<Slot, MealPlanEntry[]>();
  for (const entry of entries) {
    const inSlot = bySlot.get(entry.slot);
    if (inSlot) inSlot.push(entry);
    else bySlot.set(entry.slot, [entry]);
  }
  return bySlot;
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

/**
 * Once cooked, what was actually cooked is the interesting number; before
 * that, `actualServings` is null and the planned figure is all there is.
 * Every screen that lists entries reads this, so the plan grid and Today
 * can't disagree about the same row.
 */
export function servingsLabel(entry: MealPlanEntry): string {
  return `${toNumber(entry.actualServings ?? entry.servings)} serv`;
}
