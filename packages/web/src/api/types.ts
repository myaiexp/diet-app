// Web API client types: vocab re-exports + a barrel over types/<resource>.ts

// The enum vocabularies are the API's own (packages/api/src/vocab.ts), not a
// copy — re-exported so screens keep importing everything from this module.
import type {
  StorageLocation as PantryLocation,
  PantryStatus,
  Slot,
  EntryStatus,
  SourceType,
  Dimension,
  MatchKind,
  Rating,
  EffortCheck,
  MakeAgain,
  CookingSkill,
  ShoppingListStatus,
  ShoppingItemSource,
  SkippedGenerateReason,
} from '@diet-app/api/vocab';
export type {
  PantryLocation,
  PantryStatus,
  Slot,
  EntryStatus,
  SourceType,
  Dimension,
  MatchKind,
  Rating,
  EffortCheck,
  MakeAgain,
  CookingSkill,
  ShoppingListStatus,
  ShoppingItemSource,
  SkippedGenerateReason,
};
export { SLOTS, LOCATIONS } from '@diet-app/api/vocab';

// One file per resource; this barrel keeps `api/types.js` the single import path.
export type * from './types/ingredients.js';
export type * from './types/pantry.js';
export type * from './types/recipes.js';
export type * from './types/meal-plans.js';
export type * from './types/profile.js';
export type * from './types/recipe-import.js';
export type * from './types/shopping.js';
