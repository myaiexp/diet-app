// Zod schema for PATCH /api/profile body

import { z } from 'zod';
import { isUuid } from '../validation.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });

const cookingSkillEnum = z.enum(['beginner', 'competent', 'advanced']);

// Nullable columns accept JSON null to clear; NOT NULL columns reject null via
// non-nullable Zod types (omit = unchanged).
export const profilePatchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    calorieTargetMin: z.number().int().nonnegative().nullable().optional(),
    calorieTargetMax: z.number().int().nonnegative().nullable().optional(),
    macroTargets: z.record(z.string(), z.unknown()).nullable().optional(),
    dietaryRestrictions: z.array(z.string()).optional(),
    cookingSkill: cookingSkillEnum.optional(),
    kitchenEquipment: z.array(z.string()).optional(),
    householdSize: z.number().int().min(1).optional(),
    scheduleProfile: z.record(z.string(), z.unknown()).optional(),
    dislikedIngredientIds: z.array(uuidField).optional(),
  })
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;
