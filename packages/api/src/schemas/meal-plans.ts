// Zod schemas for meal plan entry and cook feedback write bodies

import { z } from 'zod';
import { isUuid, isIsoDate } from '../validation.js';

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

export const mealPlanCreateSchema = z
  .object({
    date: isoDateField,
    slot: z.enum(SLOTS),
    recipeId: uuidField.nullable().optional(),
    freeformNote: z.string().trim().min(1).nullable().optional(),
    servings: z.coerce.number().positive().optional(),
    status: z.enum(CREATE_STATUSES).optional(),
    substituteRecipeId: uuidField.nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((d) => d.recipeId != null || (d.freeformNote != null && d.freeformNote !== ''), {
    message: CONTENT_MSG,
  });

export const mealPlanPatchSchema = z
  .object({
    date: isoDateField.optional(),
    slot: z.enum(SLOTS).optional(),
    recipeId: uuidField.nullable().optional(),
    freeformNote: z.string().trim().min(1).nullable().optional(),
    servings: z.coerce.number().positive().optional(),
    status: z.enum(STATUSES).optional(),
    substituteRecipeId: uuidField.nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

export const feedbackCreateSchema = z
  .object({
    rating: z.enum(RATINGS),
    effortCheck: z.enum(EFFORT_CHECKS),
    makeAgain: z.enum(MAKE_AGAIN),
    usedAsIs: z.boolean(),
    changesNote: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.usedAsIs === false) {
      if (d.changesNote == null || d.changesNote === '') {
        ctx.addIssue({
          code: 'custom',
          message: 'changesNote is required when usedAsIs is false',
          path: ['changesNote'],
        });
      }
    } else if (d.changesNote != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'changesNote must be absent when usedAsIs is true',
        path: ['changesNote'],
      });
    }
  });

export const feedbackPatchSchema = z
  .object({
    rating: z.enum(RATINGS).optional(),
    effortCheck: z.enum(EFFORT_CHECKS).optional(),
    makeAgain: z.enum(MAKE_AGAIN).optional(),
    usedAsIs: z.boolean().optional(),
    changesNote: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export type MealPlanCreate = z.infer<typeof mealPlanCreateSchema>;
export type MealPlanPatch = z.infer<typeof mealPlanPatchSchema>;
export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>;
export type FeedbackPatch = z.infer<typeof feedbackPatchSchema>;
