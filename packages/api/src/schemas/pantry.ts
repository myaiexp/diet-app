// Zod schemas for pantry item POST/PATCH bodies

import { z } from 'zod';
import { isUuid, isIsoDate } from '../validation.js';
import { LOCATIONS } from '../pantry-location.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });
const isoDateField = z.string().refine(isIsoDate, { message: 'Invalid date' });

const locationEnum = z.enum(LOCATIONS);

export const pantryCreateSchema = z.object({
  ingredientId: uuidField,
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  location: locationEnum,
  addedDate: isoDateField.optional(),
  expiresDate: isoDateField.optional(),
  opened: z.boolean().optional(),
});

export const pantryPatchSchema = z
  .object({
    quantity: z.coerce.number().positive().optional(),
    unit: z.string().trim().min(1).optional(),
    location: locationEnum.optional(),
    addedDate: isoDateField.optional(),
    expiresDate: isoDateField.optional(),
    opened: z.boolean().optional(),
  })
  .strict();

export type PantryCreate = z.infer<typeof pantryCreateSchema>;
export type PantryPatch = z.infer<typeof pantryPatchSchema>;
