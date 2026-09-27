// Pure builders for the demo seed: resolve the fixtures against a real catalog
// and recipe-id map into insertable rows.
//
// No I/O — the catalog and recipesByTitle are handed in, so every builder is
// unit-testable without a database, and a catalog gap throws here, before
// seed-demo.ts writes anything.

import type { mealPlanEntries, pantryItems, recipeIngredients, recipes } from '../src/schema/index.js';
import { matchIngredient, relativeDate, mondayOfIsoWeek, type CatalogEntry } from './seed-demo-lib.js';
import { PANTRY_FIXTURE, WEEK_TEMPLATE, PROFILE_FIXTURE, type MealSlot, type WeekCell } from './seed-demo-fixtures.js';
import { RECIPES_FIXTURE } from './seed-demo-recipes.js';

export type PantryRow = typeof pantryItems.$inferInsert;
export type WeekRow = typeof mealPlanEntries.$inferInsert;
export type RecipeLine = Omit<typeof recipeIngredients.$inferInsert, 'id' | 'recipeId'>;

/** A recipes insert (no fork parent — demo recipes are all originals) plus its lines. */
export type RecipeSeed = Omit<typeof recipes.$inferInsert, 'id' | 'parentRecipeId' | 'createdAt' | 'updatedAt'> & {
  ingredientLines: RecipeLine[];
};

export interface ProfileSeed {
  columns: Omit<typeof PROFILE_FIXTURE, 'dislikedIngredients'>;
  dislikedIds: string[];
}

export function buildPantryRows(today: Date, catalog: readonly CatalogEntry[]): PantryRow[] {
  return PANTRY_FIXTURE.map((item) => {
    const ingredient = matchIngredient(item.name, catalog);
    return {
      ingredientId: ingredient.id,
      quantity: String(item.qty),
      unit: item.unit,
      location: item.location,
      addedDate: relativeDate(item.addedOffset, today),
      expiresDate: relativeDate(item.dayOffset, today),
      opened: item.opened,
    };
  });
}

export function buildRecipes(catalog: readonly CatalogEntry[]): RecipeSeed[] {
  return RECIPES_FIXTURE.map((recipe) => ({
    title: recipe.title,
    sourceType: recipe.sourceType,
    sourceUrl: null,
    steps: recipe.steps,
    prepTime: recipe.prepTime,
    totalTime: recipe.totalTime,
    servings: recipe.servings,
    effortScore: recipe.effortScore,
    tags: recipe.tags,
    cuisineType: recipe.cuisineType,
    userRating: recipe.userRating,
    timesCooked: recipe.timesCooked,
    ingredientLines: recipe.ingredients.map((line) => {
      const ingredient = matchIngredient(line.name, catalog);
      return {
        ingredientId: ingredient.id,
        quantity: String(line.qty),
        unit: line.unit,
        optional: line.optional ?? false,
        notes: line.notes ?? null,
      };
    }),
  }));
}

function resolveRecipeId(
  title: string,
  recipesByTitle: Readonly<Record<string, string>>,
  field: 'recipeId' | 'substituteRecipeId',
): string {
  const id = recipesByTitle[title];
  if (!id) {
    throw new Error(
      `buildWeekEntries: no recipe id known for "${title}" (${field}) — recipes must be written before the week`,
    );
  }
  return id;
}

export function buildWeekEntries(today: Date, recipesByTitle: Readonly<Record<string, string>>): WeekRow[] {
  const monday = mondayOfIsoWeek(today);
  const rows: WeekRow[] = [];
  for (const day of WEEK_TEMPLATE) {
    const date = relativeDate(day.offset, monday);
    for (const [slot, cell] of Object.entries(day.slots) as [MealSlot, WeekCell | null][]) {
      if (!cell) continue; // design's "empty" state — no row
      rows.push({
        date,
        slot,
        recipeId: cell.title ? resolveRecipeId(cell.title, recipesByTitle, 'recipeId') : null,
        substituteRecipeId: cell.substituteTitle
          ? resolveRecipeId(cell.substituteTitle, recipesByTitle, 'substituteRecipeId')
          : null,
        freeformNote: cell.freeformNote ?? null,
        servings: String(cell.servings),
        status: cell.status,
        notes: cell.notes ?? null,
      });
    }
  }
  return rows;
}

/**
 * The profile row's demo values, with the disliked-ingredient names resolved to
 * catalog ids. Kept pure (catalog handed in) like every other builder, so an
 * unmatched dislike fails loudly before any write.
 */
export function buildProfile(catalog: readonly CatalogEntry[]): ProfileSeed {
  const { dislikedIngredients, ...columns } = PROFILE_FIXTURE;
  return {
    columns,
    dislikedIds: dislikedIngredients.map((name) => matchIngredient(name, catalog).id),
  };
}
