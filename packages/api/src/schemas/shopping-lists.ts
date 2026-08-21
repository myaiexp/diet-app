// Zod schemas for shopping list, item, generate and complete write bodies

import { z } from 'zod';
import { isUuid, isIsoDate } from '../validation.js';
import { LOCATIONS } from '../pantry-location.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });
const isoDateField = z.string().refine(isIsoDate, { message: 'Invalid date' });

export const LIST_STATUSES = ['draft', 'shopping', 'done'] as const;

// Any date in the target week — the route snaps it to the ISO Monday.
// includeOptional opts the recipes' optional lines into the week's demand; it is
// per-generation rather than persisted, since it describes this shop rather than
// the list. Absent means false, so an old client's body behaves as before.
export const generateSchema = z
  .object({
    weekStarting: isoDateField,
    includeOptional: z.boolean().optional(),
  })
  .strict();

// 'done' is in the enum even though PATCH always refuses it, mirroring
// mealPlanPatchSchema keeping 'cooked'. The refusal belongs in the handler: a
// client asking to mark a list done has made a routing mistake, not a
// validation error, and a 409 naming POST /:id/complete points at the fix where
// a bare 400 'Validation failed' would not.
export const listPatchSchema = z
  .object({
    status: z.enum(LIST_STATUSES).optional(),
  })
  .strict();

// category, source, bought and quantityInPantry are server-derived and
// deliberately absent — see routes/shopping-list-items.ts.
export const itemCreateSchema = z
  .object({
    ingredientId: uuidField,
    quantityNeeded: z.coerce.number().positive(),
    unit: z.string().trim().min(1),
    customNote: z.string().trim().min(1).optional(),
  })
  .strict();

// ingredientId and unit are absent on purpose: changing either would move the
// row across the (list_id, ingredient_id, unit) unique index. Delete and re-add
// instead. netToBuy is nonnegative — 0 means "I have enough", which is a real
// value — while quantityNeeded is positive.
export const itemPatchSchema = z
  .object({
    bought: z.boolean().optional(),
    quantityNeeded: z.coerce.number().positive().optional(),
    netToBuy: z.coerce.number().nonnegative().optional(),
    customNote: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const completeSchema = z
  .object({
    overrides: z
      .array(
        z.object({
          itemId: uuidField,
          location: z.enum(LOCATIONS),
        }),
      )
      .optional(),
  })
  .strict();

export type GenerateBody = z.infer<typeof generateSchema>;
export type ListPatch = z.infer<typeof listPatchSchema>;
export type ItemCreate = z.infer<typeof itemCreateSchema>;
export type ItemPatch = z.infer<typeof itemPatchSchema>;
export type CompleteBody = z.infer<typeof completeSchema>;
