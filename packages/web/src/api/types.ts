// Response types mirroring the API (numeric columns arrive as strings)

export type PantryLocation = 'fridge' | 'freezer' | 'pantry' | 'counter';
export type PantryStatus = 'fresh' | 'use_soon' | 'use_today' | 'expired';
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type EntryStatus = 'planned' | 'cooked' | 'skipped' | 'substituted';
export type SourceType = 'manual' | 'imported' | 'ai' | 'forked';
export type Dimension = 'mass' | 'volume' | 'count';
export type MatchKind = 'exact' | 'alias' | 'none';
export type Rating = 'thumbs_up' | 'thumbs_down';
export type EffortCheck = 'felt_right' | 'too_hard' | 'too_easy';
export type MakeAgain = 'yes' | 'maybe' | 'no';
export type CookingSkill = 'beginner' | 'competent' | 'advanced';

export const SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const LOCATIONS: readonly PantryLocation[] = [
  'fridge',
  'freezer',
  'pantry',
  'counter',
];

export interface Ingredient {
  id: string;
  name: string;
  aliases: string[] | null;
  category: string;
  defaultUnit: string;
  nutritionPer100g: Record<string, number> | null;
  shelfLife: Record<string, number | null> | null;
  tags: string[] | null;
  isPantryStaple: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface PantryItem {
  id: string;
  ingredientId: string;
  /** numeric column — a string, never a number. */
  quantity: string;
  unit: string;
  location: PantryLocation;
  addedDate: string;
  expiresDate: string;
  opened: boolean | null;
  /**
   * Derived per row by the API (`withStatus`). Render it; never recompute — a
   * second implementation drifts on the UTC-day comparison.
   */
  status: PantryStatus;
  /**
   * Eager-loaded by every pantry endpoint. A row carries only an
   * ingredientId, and every consumer needs the name — fetching them per row
   * would cost one request per row, growing with the pantry.
   */
  ingredient: Ingredient;
  createdAt: string;
  updatedAt: string;
}

export interface PantryCreate {
  ingredientId: string;
  quantity: number;
  unit: string;
  location: PantryLocation;
  addedDate?: string;
  /** Omit and the API derives it from the ingredient's shelf life. */
  expiresDate?: string;
  opened?: boolean;
}

export interface PantryPatch {
  quantity?: number;
  unit?: string;
  location?: PantryLocation;
  addedDate?: string;
  expiresDate?: string;
  opened?: boolean;
}

export interface Recipe {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  parentRecipeId: string | null;
  steps: string[];
  prepTime: number | null;
  totalTime: number | null;
  servings: number;
  effortScore: number | null;
  tags: string[] | null;
  cuisineType: string | null;
  userRating: number | null;
  timesCooked: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredientLine {
  id: string;
  recipeId: string;
  ingredientId: string;
  quantity: string;
  unit: string;
  optional: boolean | null;
  notes: string | null;
  ingredient?: Ingredient;
}

export interface RecipeWithIngredients extends Recipe {
  recipeIngredients: RecipeIngredientLine[];
  /** Only on a `?servings=` response: the recipe's own unscaled servings. */
  baseServings?: number;
}

export interface RecipeLineInput {
  ingredientId: string;
  quantity: number;
  unit: string;
  optional?: boolean;
  notes?: string | null;
}

export interface RecipeCreate {
  title: string;
  sourceType?: SourceType;
  sourceUrl?: string | null;
  parentRecipeId?: string | null;
  steps?: string[];
  prepTime?: number;
  totalTime?: number;
  servings?: number;
  effortScore?: number;
  tags?: string[];
  cuisineType?: string | null;
  ingredients: RecipeLineInput[];
}

/** PATCH replaces the ingredient list wholesale — always send every line. */
export type RecipePatch = Partial<RecipeCreate>;

export interface MealPlanEntry {
  id: string;
  date: string;
  slot: Slot;
  recipeId: string | null;
  freeformNote: string | null;
  /** numeric column — a string. */
  servings: string;
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
  reason: 'not_in_pantry' | 'insufficient_stock' | 'unit_mismatch';
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

export interface DraftIngredientLine {
  rawName: string;
  ingredientId: string | null;
  quantity: number;
  unit: string;
  optional: boolean;
  notes: string | null;
  match: MatchKind;
  /** The model invented this quantity — the review screen's `assumed` state. */
  quantityInferred: boolean;
}

export interface RecipeDraft {
  title: string;
  sourceType: 'imported';
  sourceUrl: string | null;
  steps: string[];
  servings: number;
  prepTime: number | null;
  totalTime: number | null;
  effortScore: number | null;
  tags: string[];
  cuisineType: string | null;
  ingredients: DraftIngredientLine[];
}

export interface RecipeImportResponse {
  draft: RecipeDraft;
  unmatchedCount: number;
}
