// Row factory and closed vocabularies for the generated ingredient catalog

import type { IngredientSeedRow } from '../../src/seed-core.js';

// Closed unions so a typo in one of ~460 hand-written rows is a compile error
// instead of a new category, unit or tag that nothing else recognises.
export type Category =
  | 'produce'
  | 'protein'
  | 'dairy'
  | 'grain'
  | 'spice'
  | 'condiment'
  | 'frozen'
  | 'other';

export type DefaultUnit = 'g' | 'ml' | 'pieces';

export type Tag =
  | 'vegetarian'
  | 'vegan'
  | 'gluten-free'
  | 'dairy-free'
  | 'high-protein'
  | 'high-fiber'
  | 'whole-grain'
  | 'fermented';

export interface Nutrition {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

// Keys are `<pantry location>_days`: the API's POST /pantry reads
// shelfLife[`${location}_days`], so a key renamed here stops expiry defaults.
// `counter` is deliberately absent — the API 400s a counter item without one.
export interface ShelfLife {
  fridge_days: number | null;
  freezer_days: number | null;
  pantry_days: number | null;
}

export interface GeneratedIngredient {
  name: string;
  aliases: string[];
  category: Category;
  defaultUnit: DefaultUnit;
  nutritionPer100g: Nutrition;
  shelfLife: ShelfLife;
  tags: Tag[];
  isStaple: boolean;
}

// The seed inserts these rows as-is; this fails to compile if the shape stops
// fitting the ingredients table's insert type.
type AssertAssignable<T extends U, U> = T;
export type GeneratedRowFitsTable = AssertAssignable<GeneratedIngredient, IngredientSeedRow>;

export const shelfLifeDefaults: Record<Category, ShelfLife> = {
  produce:   { fridge_days: 7, freezer_days: 180, pantry_days: null },
  dairy:     { fridge_days: 14, freezer_days: 90, pantry_days: null },
  protein:   { fridge_days: 3, freezer_days: 180, pantry_days: null },
  grain:     { fridge_days: null, freezer_days: null, pantry_days: 365 },
  spice:     { fridge_days: null, freezer_days: null, pantry_days: 730 },
  condiment: { fridge_days: 180, freezer_days: null, pantry_days: 365 },
  frozen:    { fridge_days: null, freezer_days: 180, pantry_days: null },
  other:     { fridge_days: null, freezer_days: null, pantry_days: 365 },
};

export interface IngredientOptions {
  aliases?: string[];
  tags?: Tag[];
  /** Initial isStaple guess only — the seed never overwrites the user's flag. */
  staple?: boolean;
  /** Overrides the category default in shelfLifeDefaults. */
  shelfLife?: ShelfLife;
}

/** Builds one catalog row; key order here is the key order in ingredients.json. */
export function ingredient(
  name: string,
  category: Category,
  defaultUnit: DefaultUnit,
  nutrition: Nutrition,
  opts: IngredientOptions = {},
): GeneratedIngredient {
  return {
    name,
    aliases: opts.aliases ?? [],
    category,
    defaultUnit,
    nutritionPer100g: {
      calories: nutrition.calories,
      protein_g: nutrition.protein_g,
      carbs_g: nutrition.carbs_g,
      fat_g: nutrition.fat_g,
      fiber_g: nutrition.fiber_g,
    },
    shelfLife: opts.shelfLife ?? shelfLifeDefaults[category],
    tags: opts.tags ?? [],
    isStaple: opts.staple ?? false,
  };
}
