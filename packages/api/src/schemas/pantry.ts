// Zod schemas for pantry item POST/PATCH bodies

import { z } from 'zod';
import { LOCATIONS } from '../vocab.js';
import { KNOWN_UNITS, resolveUnit } from '../units.js';
import { unitText, uuidField, isoDateField, quantityPositive } from './fields.js';

const locationEnum = z.enum(LOCATIONS);

// Cook and shopping convert every lot through units.ts and silently stop seeing
// a row they cannot resolve, so a pantry unit has to be one they can.
const pantryUnit = unitText.refine((unit) => resolveUnit(unit) !== null, {
  message: `Unrecognized unit — use one of ${KNOWN_UNITS.join(', ')}`,
});

export const pantryCreateSchema = z.object({
  ingredientId: uuidField,
  quantity: quantityPositive,
  unit: pantryUnit,
  location: locationEnum,
  addedDate: isoDateField.optional(),
  expiresDate: isoDateField.optional(),
  opened: z.boolean().optional(),
});

export const pantryPatchSchema = z
  .object({
    quantity: quantityPositive.optional(),
    unit: pantryUnit.optional(),
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
