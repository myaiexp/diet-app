// Schema barrel: re-exports all table definitions and the relation graph
export { ingredients } from './ingredients.js';
export { recipes, recipeIngredients } from './recipes.js';
export { pantryItems } from './pantry.js';
export { mealPlanEntries, cookFeedback } from './meal-plans.js';
export { shoppingLists, shoppingListItems } from './shopping-lists.js';
export { userProfile, userDislikedIngredients } from './user-profile.js';

export * from './relations.js';
