import { relations } from 'drizzle-orm';

// Tables
export { ingredients } from './ingredients.js';
export { recipes, recipeIngredients } from './recipes.js';
export { pantryItems } from './pantry.js';
export { mealPlanEntries, cookFeedback } from './meal-plans.js';
export { shoppingLists, shoppingListItems } from './shopping-lists.js';
export { userProfile } from './user-profile.js';

// Import tables for relation definitions
import { ingredients } from './ingredients.js';
import { recipes, recipeIngredients } from './recipes.js';
import { pantryItems } from './pantry.js';
import { mealPlanEntries, cookFeedback } from './meal-plans.js';
import { shoppingLists, shoppingListItems } from './shopping-lists.js';

// ─── Relations ────────────────────────────────────────────────────────────────

export const ingredientsRelations = relations(ingredients, ({ many }) => ({
  recipeIngredients: many(recipeIngredients),
  pantryItems: many(pantryItems),
  shoppingListItems: many(shoppingListItems),
}));

export const recipesRelations = relations(recipes, ({ many, one }) => ({
  recipeIngredients: many(recipeIngredients),
  mealPlanEntries: many(mealPlanEntries, { relationName: 'recipe_meal_plans' }),
  substituteMealPlanEntries: many(mealPlanEntries, { relationName: 'substitute_recipe_meal_plans' }),
  parentRecipe: one(recipes, {
    fields: [recipes.parentRecipeId],
    references: [recipes.id],
    relationName: 'recipe_variants',
  }),
  childRecipes: many(recipes, { relationName: 'recipe_variants' }),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeIngredients.recipeId],
    references: [recipes.id],
  }),
  ingredient: one(ingredients, {
    fields: [recipeIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const pantryItemsRelations = relations(pantryItems, ({ one }) => ({
  ingredient: one(ingredients, {
    fields: [pantryItems.ingredientId],
    references: [ingredients.id],
  }),
}));

export const mealPlanEntriesRelations = relations(mealPlanEntries, ({ one }) => ({
  recipe: one(recipes, {
    fields: [mealPlanEntries.recipeId],
    references: [recipes.id],
    relationName: 'recipe_meal_plans',
  }),
  substituteRecipe: one(recipes, {
    fields: [mealPlanEntries.substituteRecipeId],
    references: [recipes.id],
    relationName: 'substitute_recipe_meal_plans',
  }),
  cookFeedback: one(cookFeedback, {
    fields: [mealPlanEntries.id],
    references: [cookFeedback.mealPlanEntryId],
  }),
}));

export const cookFeedbackRelations = relations(cookFeedback, ({ one }) => ({
  mealPlanEntry: one(mealPlanEntries, {
    fields: [cookFeedback.mealPlanEntryId],
    references: [mealPlanEntries.id],
  }),
}));

export const shoppingListsRelations = relations(shoppingLists, ({ many }) => ({
  items: many(shoppingListItems),
}));

export const shoppingListItemsRelations = relations(shoppingListItems, ({ one }) => ({
  list: one(shoppingLists, {
    fields: [shoppingListItems.listId],
    references: [shoppingLists.id],
  }),
  ingredient: one(ingredients, {
    fields: [shoppingListItems.ingredientId],
    references: [ingredients.id],
  }),
}));
