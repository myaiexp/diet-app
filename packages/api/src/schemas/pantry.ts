// Zod schemas for pantry item POST/PATCH bodies

import { z } from 'zod';
import { LOCATIONS } from '../vocab.js';
import { unitText, uuidField, isoDateField, quantityPositive } from './fields.js';

const locationEnum = z.enum(LOCATIONS);

export const pantryCreateSchema = z.object({
  ingredientId: uuidField,
  quantity: quantityPositive,
  unit: unitText,
  location: locationEnum,
  addedDate: isoDateField.optional(),
  expiresDate: isoDateField.optional(),
  opened: z.boolean().optional(),
});

export const pantryPatchSchema = z
  .object({
    quantity: quantityPositive.optional(),
    unit: unitText.optional(),
    location: locationEnum.optional(),
    addedDate: isoDateField.optional(),
    expiresDate: isoDateField.optional(),
    opened: z.boolean().optional(),
    /** Refuse the write unless the stored quantity still equals this (409). */
    expectedQuantity: quantityPositive.optional(),
  })
  .strict()
  .refine((d) => d.expectedQuantity === undefined || d.quantity !== undefined, {
    message: 'expectedQuantity requires quantity',
    path: ['expectedQuantity'],
  });

export type PantryCreate = z.infer<typeof pantryCreateSchema>;
export type PantryPatch = z.infer<typeof pantryPatchSchema>;
