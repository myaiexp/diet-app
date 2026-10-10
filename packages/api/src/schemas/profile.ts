// Zod schema for PATCH /api/profile body

import { z } from 'zod';
import { COOKING_SKILLS } from '../vocab.js';
import {
  LIMITS,
  nameText,
  chipsField,
  macroTargetsSchema,
  scheduleProfileSchema,
  uuidField,
} from './fields.js';

const cookingSkillEnum = z.enum(COOKING_SKILLS);
const calorieInt = z.number().int().nonnegative().max(LIMITS.calories);

// Nullable columns accept JSON null to clear; NOT NULL columns reject null via
// non-nullable Zod types (omit = unchanged).
export const profilePatchSchema = z
  .object({
    name: nameText.optional(),
    calorieTargetMin: calorieInt.nullable().optional(),
    calorieTargetMax: calorieInt.nullable().optional(),
    macroTargets: macroTargetsSchema.nullable().optional(),
    dietaryRestrictions: chipsField.optional(),
    cookingSkill: cookingSkillEnum.optional(),
    kitchenEquipment: chipsField.optional(),
    householdSize: z.number().int().min(1).max(LIMITS.householdSize).optional(),
    scheduleProfile: scheduleProfileSchema.optional(),
    dislikedIngredientIds: z.array(uuidField).max(LIMITS.ids).optional(),
  })
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;
