// Singleton user profile and its patch body
import type { CookingSkill } from '@diet-app/api/vocab';

export interface UserProfile {
  id: string;
  name: string;
  calorieTargetMin: number | null;
  calorieTargetMax: number | null;
  macroTargets: Record<string, number> | null;
  dietaryRestrictions: string[] | null;
  cookingSkill: CookingSkill;
  kitchenEquipment: string[] | null;
  householdSize: number;
  scheduleProfile: Record<string, unknown>;
  /** From the junction table, not a profile column. */
  dislikedIngredientIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProfilePatch {
  name?: string;
  calorieTargetMin?: number | null;
  calorieTargetMax?: number | null;
  macroTargets?: Record<string, number> | null;
  dietaryRestrictions?: string[];
  cookingSkill?: CookingSkill;
  kitchenEquipment?: string[];
  householdSize?: number;
  scheduleProfile?: Record<string, unknown>;
  dislikedIngredientIds?: string[];
}
