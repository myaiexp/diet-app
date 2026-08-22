// Overrides-based API fixture builders for web tests.
//
// Complete, valid rows. Suites that care about a name, status, or date pass
// overrides — they do not re-declare the rest of the shape. Nested
// `ingredient` on pantry/shopping items defaults to makeIngredient() and is
// replaced wholesale when the caller supplies one.

import { isoToday } from '../format/date.js';
import type {
  CookFeedback,
  DraftIngredientLine,
  Ingredient,
  MealPlanEntry,
  PantryItem,
  Recipe,
  RecipeDraft,
  ShoppingItem,
  ShoppingList,
  UserProfile,
} from '../api/types.js';

const ING_AT = '2026-01-01T00:00:00.000Z';
const AT = '2026-08-01T00:00:00.000Z';

export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    name: 'Milk',
    aliases: ['maito'],
    category: 'dairy',
    defaultUnit: 'l',
    nutritionPer100g: null,
    shelfLife: null,
    tags: null,
    isPantryStaple: null,
    createdAt: ING_AT,
    updatedAt: ING_AT,
    ...overrides,
  };
}

export function makePantryItem(overrides: Partial<PantryItem> = {}): PantryItem {
  return {
    id: 'item-1',
    ingredientId: 'ing-1',
    quantity: '400',
    unit: 'g',
    location: 'fridge',
    addedDate: '2026-08-01',
    expiresDate: '2026-08-10',
    opened: false,
    status: 'fresh',
    ingredient: makeIngredient(),
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Lohikeitto',
    sourceType: 'manual',
    sourceUrl: null,
    parentRecipeId: null,
    steps: [],
    prepTime: 15,
    totalTime: 35,
    servings: 4,
    effortScore: 2,
    tags: null,
    cuisineType: null,
    userRating: null,
    timesCooked: 11,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e1',
    date: isoToday(),
    slot: 'dinner',
    recipeId: null,
    freeformNote: 'Leftovers',
    servings: '2',
    status: 'planned',
    substituteRecipeId: null,
    notes: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function makeFeedback(entryId: string, overrides: Partial<CookFeedback> = {}): CookFeedback {
  return {
    id: `fb-${entryId}`,
    mealPlanEntryId: entryId,
    rating: 'thumbs_up',
    effortCheck: 'felt_right',
    makeAgain: 'yes',
    usedAsIs: true,
    changesNote: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function makeShoppingItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'item-1',
    listId: 'list-1',
    ingredientId: 'ing-1',
    quantityNeeded: '400',
    quantityInPantry: '0',
    netToBuy: '400',
    category: 'produce',
    unit: 'g',
    source: 'generated',
    bought: false,
    customNote: null,
    ingredient: makeIngredient({
      name: 'Leek',
      aliases: ['purjo'],
      category: 'produce',
      defaultUnit: 'pieces',
      isPantryStaple: false,
    }),
    ...overrides,
  };
}

export function makeShoppingList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: 'list-1',
    weekStarting: '2026-08-17',
    status: 'draft',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    name: 'Mase',
    calorieTargetMin: 2100,
    calorieTargetMax: 2500,
    macroTargets: { protein: 130, carbs: 230, fat: 80 },
    dietaryRestrictions: ['no shellfish', 'low lactose'],
    cookingSkill: 'competent',
    kitchenEquipment: ['oven', 'hob 4'],
    householdSize: 2,
    scheduleProfile: { note: 'late shift tue+thu' },
    dislikedIngredientIds: ['ing-1', 'ing-2'],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function makeLine(overrides: Partial<DraftIngredientLine> = {}): DraftIngredientLine {
  return {
    rawName: '3 dl ohrasuurimoita',
    ingredientId: 'ing-barley',
    quantity: 300,
    unit: 'ml',
    optional: false,
    notes: null,
    match: 'exact',
    quantityInferred: false,
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    title: 'Ohrarisotto metsäsienillä',
    sourceType: 'imported',
    sourceUrl: 'https://example.com/recipe',
    steps: ['Step one', 'Step two'],
    servings: 4,
    prepTime: 15,
    totalTime: 40,
    effortScore: 3,
    tags: ['oven'],
    cuisineType: 'Finnish',
    ingredients: [makeLine()],
    ...overrides,
  };
}
