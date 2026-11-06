// Recipe rows, ingredient lines, and the create/patch bodies
import type { SourceType } from '@diet-app/api/vocab';
import type { Ingredient } from './ingredients.js';

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
