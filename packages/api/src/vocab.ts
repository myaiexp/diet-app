// API contract vocabularies and limits — the one copy the web client also imports
//
// packages/web imports this file from source as `@diet-app/api/vocab` (a Vite
// alias plus a tsconfig `paths` entry), so the client's enum tuples, servings
// cap and base units cannot drift from what the API validates. Keep it
// import-free and runtime-agnostic: anything it imported would be pulled into
// the browser bundle.

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Slot = (typeof SLOTS)[number];

export const STATUSES = ['planned', 'cooked', 'skipped', 'substituted'] as const;
export type EntryStatus = (typeof STATUSES)[number];
// Everything but cooked — that status is owned exclusively by POST /:id/cook,
// so it is the set create accepts and the set the web's edit modal offers.
export const CREATE_STATUSES = ['planned', 'skipped', 'substituted'] as const;

export const RATINGS = ['thumbs_up', 'thumbs_down'] as const;
export type Rating = (typeof RATINGS)[number];
export const EFFORT_CHECKS = ['felt_right', 'too_hard', 'too_easy'] as const;
export type EffortCheck = (typeof EFFORT_CHECKS)[number];
export const MAKE_AGAIN = ['yes', 'maybe', 'no'] as const;
export type MakeAgain = (typeof MAKE_AGAIN)[number];

export const LOCATIONS = ['fridge', 'freezer', 'pantry', 'counter'] as const;
export type StorageLocation = (typeof LOCATIONS)[number];
export const PANTRY_STATUSES = ['fresh', 'use_soon', 'use_today', 'expired'] as const;
export type PantryStatus = (typeof PANTRY_STATUSES)[number];

export const LIST_STATUSES = ['draft', 'shopping', 'done'] as const;
export type ShoppingListStatus = (typeof LIST_STATUSES)[number];
export type ShoppingItemSource = 'generated' | 'manual';
/** Why POST /shopping-lists/generate left an entry or line out of the list. */
export type SkippedGenerateReason = 'unknown_unit' | 'recipe_missing' | 'bad_scale';

/** How recipe import bound an extracted ingredient name to a catalog row. */
export type MatchKind = 'exact' | 'alias' | 'none';

export const SOURCE_TYPES = ['manual', 'imported', 'ai', 'forked'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const COOKING_SKILLS = ['beginner', 'competent', 'advanced'] as const;
export type CookingSkill = (typeof COOKING_SKILLS)[number];

/** Integer 1–12 — the cap every servings write, query and stepper uses. */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 12;

/** Pull a stepper/input value into the servings range. */
export function clampServings(n: number): number {
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
}

export const DIMENSIONS = ['mass', 'volume', 'count'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

// The base unit label for a dimension: mass → g, volume → ml, count → pieces
// (never `pcs`). Shopping list items and cook shortfalls are stored in it.
export function baseUnit(dimension: Dimension): 'g' | 'ml' | 'pieces' {
  switch (dimension) {
    case 'mass':
      return 'g';
    case 'volume':
      return 'ml';
    case 'count':
      return 'pieces';
  }
}
