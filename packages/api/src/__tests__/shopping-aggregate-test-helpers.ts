// Shared fixtures and builders for the shopping-aggregate test slices

import type {
  aggregateShoppingList,
  PlanEntry,
  AggregateRecipeLine,
  PantrySupplyRow,
} from '../shopping-aggregate.js';

export const TODAY = '2026-08-04'; // a Tuesday
export const MONDAY = '2026-08-03'; // the day before TODAY, still inside the current week
export const WEDNESDAY = '2026-08-05';
export const THURSDAY = '2026-08-06';
export const FRIDAY = '2026-08-07';
export const SATURDAY = '2026-08-08';
export const SUNDAY = '2026-08-09';

export const ENTRY = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  id: 'e1',
  recipeId: 'r1',
  substituteRecipeId: null,
  servings: 4,
  status: 'planned',
  date: TODAY,
  ...over,
});

export const LINE = (over: Partial<AggregateRecipeLine> = {}): AggregateRecipeLine => ({
  ingredientId: 'i1',
  quantity: 400,
  unit: 'g',
  optional: false,
  ...over,
});

export const ROW = (over: Partial<PantrySupplyRow> = {}): PantrySupplyRow => ({
  ingredientId: 'i1',
  quantity: 300,
  unit: 'g',
  expiresDate: '2026-08-10',
  ...over,
});

export type Input = Parameters<typeof aggregateShoppingList>[0];

export const baseInput = (over: Partial<Input> = {}): Input => ({
  entries: [ENTRY()],
  recipesById: new Map([['r1', { servings: 4 }]]),
  linesByRecipe: new Map([['r1', [LINE()]]]),
  pantryRows: [],
  ingredientsById: new Map([['i1', { category: 'produce' }]]),
  today: TODAY,
  ...over,
});
