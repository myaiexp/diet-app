// Meal plan entries, the cook commit, its read-only preview, and feedback

import { apiGet, apiSend } from './client.js';
import type {
  MealPlanEntry,
  MealPlanCreate,
  MealPlanPatch,
  CookPreview,
  CookResult,
  CookFeedback,
  FeedbackCreate,
} from './types.js';

/** Bounded to one ISO week — no pagination. `monday` is any date in the week. */
export function getWeek(monday: string): Promise<MealPlanEntry[]> {
  return apiGet<MealPlanEntry[]>(`/meal-plans/week/${monday}`);
}

export function createEntry(body: MealPlanCreate): Promise<MealPlanEntry> {
  return apiSend<MealPlanEntry>('POST', '/meal-plans', body);
}

/**
 * PATCH cannot set `cooked` (only POST /:id/cook does), and on an already-cooked
 * entry it cannot change recipeId, substituteRecipeId or servings — those are
 * the inputs the deduction was computed from.
 */
export function patchEntry(id: string, body: MealPlanPatch): Promise<MealPlanEntry> {
  return apiSend<MealPlanEntry>('PATCH', `/meal-plans/${id}`, body);
}

export function deleteEntry(id: string): Promise<void> {
  return apiSend<void>('DELETE', `/meal-plans/${id}`);
}

/**
 * What a cook *would* deduct. Read-only and lock-free, so it can go stale: the
 * commit response is the source of truth and the client reconciles from that.
 */
export function previewCook(id: string, servings?: number): Promise<CookPreview> {
  return apiGet<CookPreview>(
    `/meal-plans/${id}/cook-preview`,
    servings !== undefined ? { servings } : undefined,
  );
}

/** Irreversible: deducts pantry stock and locks the entry. 409 if already cooked. */
export function cook(id: string): Promise<CookResult> {
  return apiSend<CookResult>('POST', `/meal-plans/${id}/cook`);
}

/** A note is required iff usedAsIs is false; sending one alongside true is a 400. */
export function saveFeedback(
  entryId: string,
  body: FeedbackCreate,
): Promise<CookFeedback> {
  return apiSend<CookFeedback>('POST', `/meal-plans/${entryId}/feedback`, body);
}

export function getFeedback(entryId: string): Promise<CookFeedback> {
  return apiGet<CookFeedback>(`/meal-plans/${entryId}/feedback`);
}
