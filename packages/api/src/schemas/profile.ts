// Zod schema for PATCH /api/profile body

import { z } from 'zod';
import { isUuid } from '../validation.js';
import {
  LIMITS,
  nameText,
  chipsField,
  macroTargetsSchema,
  scheduleProfileSchema,
} from './fields.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });

const cookingSkillEnum = z.enum(['beginner', 'competent', 'advanced']);

// Nullable columns accept JSON null to clear; NOT NULL columns reject null via
// non-nullable Zod types (omit = unchanged).
export const profilePatchSchema = z
  .object({
    name: nameText.optional(),
    calorieTargetMin: z.number().int().nonnegative().nullable().optional(),
    calorieTargetMax: z.number().int().nonnegative().nullable().optional(),
    macroTargets: macroTargetsSchema.nullable().optional(),
    dietaryRestrictions: chipsField.optional(),
    cookingSkill: cookingSkillEnum.optional(),
    kitchenEquipment: chipsField.optional(),
    householdSize: z.number().int().min(1).optional(),
    scheduleProfile: scheduleProfileSchema.optional(),
    dislikedIngredientIds: z.array(uuidField).max(LIMITS.ids).optional(),
  })
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;
