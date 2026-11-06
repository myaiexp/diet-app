// Meal plan entries, the cook preview/result, and cook feedback
import type { Slot, EntryStatus, Dimension, Rating, EffortCheck, MakeAgain } from '@diet-app/api/vocab';

export interface MealPlanEntry {
  id: string;
  date: string;
  slot: Slot;
  recipeId: string | null;
  freeformNote: string | null;
  /** What was planned. numeric column — a string. Cooking never rewrites it. */
  servings: string;
  /** What was actually cooked — written once by POST /cook, null until then. */
  actualServings: string | null;
  status: EntryStatus;
  substituteRecipeId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MealPlanCreate {
  date: string;
  slot: Slot;
  /** One of recipeId / freeformNote is required — never neither. */
  recipeId?: string | null;
  freeformNote?: string | null;
  servings?: number;
  status?: Exclude<EntryStatus, 'cooked'>;
  substituteRecipeId?: string | null;
  notes?: string | null;
}

export type MealPlanPatch = Partial<MealPlanCreate>;

export interface PantryChange {
  id: string;
  unit: string;
  before: string;
  after: string;
  deleted: boolean;
}

export interface Deduction {
  ingredientId: string;
  dimension: Dimension;
  /** Base units (g / ml / pieces), after scaling. A number, not a string. */
  requested: number;
  deducted: number;
  pantryItems: PantryChange[];
}

export interface Shortfall {
  ingredientId: string;
  dimension: Dimension | null;
  requested: number;
  available: number;
  reason: 'not_in_pantry' | 'insufficient_stock' | 'unit_mismatch' | 'only_expired';
}

/** GET /meal-plans/:id/cook-preview — read-only, may be stale by commit time. */
export interface CookPreview {
  deductions: Deduction[];
  shortfalls: Shortfall[];
  servings: number;
}

/** POST /meal-plans/:id/cook — the authoritative result; reconcile from this. */
export interface CookResult {
  entry: MealPlanEntry;
  deductions: Deduction[];
  shortfalls: Shortfall[];
}

export interface CookFeedback {
  id: string;
  mealPlanEntryId: string;
  rating: Rating;
  effortCheck: EffortCheck;
  makeAgain: MakeAgain;
  usedAsIs: boolean;
  changesNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackCreate {
  rating: Rating;
  effortCheck: EffortCheck;
  makeAgain: MakeAgain;
  usedAsIs: boolean;
  /** Required iff usedAsIs is false; sending it alongside true is a 400. */
  changesNote?: string;
}
