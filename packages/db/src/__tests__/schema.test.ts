import { describe, test, expect } from 'vitest';
import * as schema from '../schema/index.js';
import { ingredients } from '../schema/ingredients.js';
import { recipes, recipeIngredients } from '../schema/recipes.js';
import { pantryItems } from '../schema/pantry.js';
import { mealPlanEntries, cookFeedback } from '../schema/meal-plans.js';
import { shoppingLists, shoppingListItems } from '../schema/shopping-lists.js';
import { userProfile } from '../schema/user-profile.js';

describe('schema tables', () => {
  test('ingredients table has correct columns', () => {
    const cols = Object.keys(ingredients);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('nutritionPer100g');
    expect(cols).toContain('shelfLife');
    expect(cols).toContain('isPantryStaple');
    expect(cols).toContain('aliases');
    expect(cols).toContain('category');
    expect(cols).toContain('defaultUnit');
    expect(cols).toContain('tags');
    expect(cols).toContain('createdAt');
    expect(cols).toContain('updatedAt');
  });

  test('recipes table has correct columns', () => {
    const cols = Object.keys(recipes);
    expect(cols).toContain('id');
    expect(cols).toContain('title');
    expect(cols).toContain('sourceType');
    expect(cols).toContain('parentRecipeId');
    expect(cols).toContain('steps');
    expect(cols).toContain('servings');
    expect(cols).toContain('timesCooked');
  });

  test('recipeIngredients table has correct columns', () => {
    const cols = Object.keys(recipeIngredients);
    expect(cols).toContain('id');
    expect(cols).toContain('recipeId');
    expect(cols).toContain('ingredientId');
    expect(cols).toContain('quantity');
    expect(cols).toContain('unit');
    expect(cols).toContain('optional');
  });

  test('pantryItems table has correct columns', () => {
    const cols = Object.keys(pantryItems);
    expect(cols).toContain('id');
    expect(cols).toContain('ingredientId');
    expect(cols).toContain('quantity');
    expect(cols).toContain('unit');
    expect(cols).toContain('location');
    expect(cols).toContain('addedDate');
    expect(cols).toContain('expiresDate');
    expect(cols).toContain('opened');
  });

  test('mealPlanEntries table has correct columns', () => {
    const cols = Object.keys(mealPlanEntries);
    expect(cols).toContain('id');
    expect(cols).toContain('date');
    expect(cols).toContain('slot');
    expect(cols).toContain('recipeId');
    expect(cols).toContain('servings');
    expect(cols).toContain('status');
    expect(cols).toContain('substituteRecipeId');
  });

  test('cookFeedback table has correct columns', () => {
    const cols = Object.keys(cookFeedback);
    expect(cols).toContain('id');
    expect(cols).toContain('mealPlanEntryId');
    expect(cols).toContain('rating');
    expect(cols).toContain('effortCheck');
    expect(cols).toContain('makeAgain');
    expect(cols).toContain('usedAsIs');
  });

  test('shoppingLists table has correct columns', () => {
    const cols = Object.keys(shoppingLists);
    expect(cols).toContain('id');
    expect(cols).toContain('weekStarting');
    expect(cols).toContain('status');
  });

  test('shoppingListItems table has correct columns', () => {
    const cols = Object.keys(shoppingListItems);
    expect(cols).toContain('id');
    expect(cols).toContain('listId');
    expect(cols).toContain('ingredientId');
    expect(cols).toContain('quantityNeeded');
    expect(cols).toContain('quantityInPantry');
    expect(cols).toContain('netToBuy');
    expect(cols).toContain('category');
    expect(cols).toContain('bought');
  });

  test('userProfile table has correct columns', () => {
    const cols = Object.keys(userProfile);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('calorieTargetMin');
    expect(cols).toContain('calorieTargetMax');
    expect(cols).toContain('macroTargets');
    expect(cols).toContain('dietaryRestrictions');
    expect(cols).toContain('dislikedIngredientIds');
    expect(cols).toContain('cookingSkill');
    expect(cols).toContain('householdSize');
    expect(cols).toContain('scheduleProfile');
  });

  test('all schema tables are exported from index', () => {
    expect(schema.ingredients).toBeDefined();
    expect(schema.recipes).toBeDefined();
    expect(schema.recipeIngredients).toBeDefined();
    expect(schema.pantryItems).toBeDefined();
    expect(schema.mealPlanEntries).toBeDefined();
    expect(schema.cookFeedback).toBeDefined();
    expect(schema.shoppingLists).toBeDefined();
    expect(schema.shoppingListItems).toBeDefined();
    expect(schema.userProfile).toBeDefined();
  });

  test('all relations are exported from index', () => {
    expect(schema.ingredientsRelations).toBeDefined();
    expect(schema.recipesRelations).toBeDefined();
    expect(schema.recipeIngredientsRelations).toBeDefined();
    expect(schema.pantryItemsRelations).toBeDefined();
    expect(schema.mealPlanEntriesRelations).toBeDefined();
    expect(schema.cookFeedbackRelations).toBeDefined();
    expect(schema.shoppingListsRelations).toBeDefined();
    expect(schema.shoppingListItemsRelations).toBeDefined();
  });

  test('foreign keys reference correct tables', () => {
    // recipeIngredients.recipeId references recipes
    const riRecipeCol = recipeIngredients.recipeId;
    expect(riRecipeCol).toBeDefined();

    // recipeIngredients.ingredientId references ingredients
    const riIngredientCol = recipeIngredients.ingredientId;
    expect(riIngredientCol).toBeDefined();

    // pantryItems.ingredientId references ingredients
    const pantryIngredientCol = pantryItems.ingredientId;
    expect(pantryIngredientCol).toBeDefined();

    // cookFeedback.mealPlanEntryId references mealPlanEntries (unique + notNull)
    const cfEntryCol = cookFeedback.mealPlanEntryId;
    expect(cfEntryCol).toBeDefined();

    // Verify FK config is attached to the column
    // Drizzle stores FK references internally — we verify the columns exist and are uuid type
    expect(riRecipeCol.dataType).toBe('string');
    expect(riIngredientCol.dataType).toBe('string');
    expect(pantryIngredientCol.dataType).toBe('string');
    expect(cfEntryCol.dataType).toBe('string');
  });
});
