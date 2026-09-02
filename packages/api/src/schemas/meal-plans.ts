// Zod schemas for meal plan entry and cook feedback write bodies

import { z } from 'zod';
import { isUuid, isIsoDate } from '../validation.js';
import { trimmedNote, noteText, servingsCoerced } from './fields.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });
const isoDateField = z.string().refine(isIsoDate, { message: 'Invalid date' });

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const STATUSES = ['planned', 'cooked', 'skipped', 'substituted'] as const;
// Create cannot set cooked — that status is owned exclusively by POST /:id/cook.
export const CREATE_STATUSES = ['planned', 'skipped', 'substituted'] as const;
export const RATINGS = ['thumbs_up', 'thumbs_down'] as const;
export const EFFORT_CHECKS = ['felt_right', 'too_hard', 'too_easy'] as const;
export const MAKE_AGAIN = ['yes', 'maybe', 'no'] as const;

export const CONTENT_MSG = 'Either recipeId or freeformNote is required';

/** Cook/shopping resolve substituteRecipeId ?? recipeId, so a substitute-only
 *  row (demo Friday dinner) is content even with recipeId and the note null. */
export function hasContent(
  recipeId: string | null | undefined,
  freeformNote: string | null | undefined,
  substituteRecipeId?: string | null,
): boolean {
  return (
    recipeId != null ||
    substituteRecipeId != null ||
    (freeformNote != null && freeformNote !== '')
  );
}

export const mealPlanCreateSchema = z
  .object({
    date: isoDateField,
    slot: z.enum(SLOTS),
    recipeId: uuidField.nullable().optional(),
    freeformNote: trimmedNote.nullable().optional(),
    servings: servingsCoerced.optional(),
    status: z.enum(CREATE_STATUSES).optional(),
    substituteRecipeId: uuidField.nullable().optional(),
    notes: noteText.nullable().optional(),
  })
  .refine((d) => hasContent(d.recipeId, d.freeformNote, d.substituteRecipeId), {
    message: CONTENT_MSG,
  });

export const mealPlanPatchSchema = z
  .object({
    date: isoDateField.optional(),
    slot: z.enum(SLOTS).optional(),
    recipeId: uuidField.nullable().optional(),
    freeformNote: trimmedNote.nullable().optional(),
    servings: servingsCoerced.optional(),
    status: z.enum(STATUSES).optional(),
    substituteRecipeId: uuidField.nullable().optional(),
    notes: noteText.nullable().optional(),
  })
  .strict();

export const NOTE_REQUIRED_MSG = 'changesNote is required when usedAsIs is false';
export const NOTE_ABSENT_MSG = 'changesNote must be absent when usedAsIs is true';

/**
 * The one encoding of the cook-feedback invariant: a note iff the cook changed
 * something. Returns the violation message, or null when the pair is legal.
 *
 * POST validates the parsed body through this and PATCH validates the merged
 * row through it, so the two entry points cannot drift on either the rule or
 * its wording. `''` counts as no note — the column has no CHECK, so a stored
 * empty string reaches the PATCH side even though `trimmedNote` keeps one out
 * of a request body.
 */
export function feedbackPairError(
  usedAsIs: boolean,
  changesNote: string | null | undefined,
): string | null {
  if (usedAsIs === false) {
    return changesNote == null || changesNote === '' ? NOTE_REQUIRED_MSG : null;
  }
  return changesNote != null ? NOTE_ABSENT_MSG : null;
}

export const feedbackCreateSchema = z
  .object({
    rating: z.enum(RATINGS),
    effortCheck: z.enum(EFFORT_CHECKS),
    makeAgain: z.enum(MAKE_AGAIN),
    usedAsIs: z.boolean(),
    changesNote: trimmedNote.nullable().optional(),
  })
  .superRefine((d, ctx) => {
    const message = feedbackPairError(d.usedAsIs, d.changesNote);
    if (message) ctx.addIssue({ code: 'custom', message, path: ['changesNote'] });
  });

export const feedbackPatchSchema = z
  .object({
    rating: z.enum(RATINGS).optional(),
    effortCheck: z.enum(EFFORT_CHECKS).optional(),
    makeAgain: z.enum(MAKE_AGAIN).optional(),
    usedAsIs: z.boolean().optional(),
    changesNote: trimmedNote.nullable().optional(),
  })
  .strict();

export type MealPlanCreate = z.infer<typeof mealPlanCreateSchema>;
export type MealPlanPatch = z.infer<typeof mealPlanPatchSchema>;
export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>;
export type FeedbackPatch = z.infer<typeof feedbackPatchSchema>;
