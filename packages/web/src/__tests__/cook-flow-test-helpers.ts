// Fixtures, fetch router and call inspectors for the cook-flow modal suites

import { vi, type Mock } from 'vitest';
import type { MealPlanEntry, RecipeWithIngredients, PantryItem } from '../api/types.js';
import { jsonResponse, routeFetch } from './harness.js';
import { makeEntry, makeIngredient, makePantryItem } from './fixtures.js';

export function click(selector: string): void {
  const node = document.querySelector<HTMLButtonElement>(selector);
  if (!node) throw new Error(`selector not found: ${selector}`);
  node.click();
}

export function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ingredientLine(ingredientId: string, name: string, quantity: string) {
  return {
    id: `ri-${ingredientId}`,
    recipeId: 'r1',
    ingredientId,
    quantity,
    unit: 'g',
    optional: false,
    notes: null,
    ingredient: makeIngredient({
      id: ingredientId,
      name,
      aliases: null,
      category: 'misc',
      defaultUnit: 'g',
      createdAt: '',
      updatedAt: '',
    }),
  };
}

export const ENTRY: MealPlanEntry = makeEntry({
  date: '2026-08-04',
  recipeId: 'r1',
  freeformNote: null,
  servings: '4',
});

export const RECIPE: RecipeWithIngredients = {
  id: 'r1',
  title: 'Lohikeitto',
  sourceType: 'manual',
  sourceUrl: null,
  parentRecipeId: null,
  steps: [],
  prepTime: null,
  totalTime: null,
  servings: 4,
  effortScore: null,
  tags: null,
  cuisineType: null,
  userRating: null,
  timesCooked: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  // salmon deducts from pantry row p1; dill is never in the pantry — a shortfall.
  recipeIngredients: [ingredientLine('salmon', 'Salmon', '400'), ingredientLine('dill', 'Dill', '10')],
};

export const PANTRY: PantryItem[] = [
  makePantryItem({
    id: 'p1',
    ingredientId: 'salmon',
    quantity: '500',
    addedDate: isoDaysFromNow(-2),
    expiresDate: isoDaysFromNow(0),
    status: 'use_today',
    ingredient: makeIngredient({
      id: 'salmon',
      name: 'Salmon',
      aliases: ['lohi'],
      category: 'protein',
      defaultUnit: 'g',
    }),
  }),
];

export function deductionPlan(servings: number) {
  const scale = servings / 4;
  const after = 500 - 400 * scale;
  return {
    deductions: [
      {
        ingredientId: 'salmon',
        dimension: 'mass' as const,
        requested: 400 * scale,
        deducted: 400 * scale,
        pantryItems: [{ id: 'p1', unit: 'g', before: '500', after: String(after), deleted: after <= 0 }],
      },
    ],
    shortfalls: [
      { ingredientId: 'dill', dimension: 'mass' as const, requested: 10 * scale, available: 0, reason: 'not_in_pantry' as const },
    ],
  };
}

interface RouteOpts {
  cookStatus?: number;
  feedbackStatus?: number;
  pantryStatus?: number;
  recipeStatus?: number;
}

/** Routes the entry-e1 flow: recipe, pantry, preview, PATCH, cook, feedback. */
export function buildRouter(opts: RouteOpts = {}) {
  // `servings` is the entry's planned figure and never moves: only POST /cook's
  // body decides what is actually cooked, and it is recorded separately.
  const state = { servings: 4 };
  return routeFetch({
    'GET /api/recipes/:id': () => {
      if (opts.recipeStatus && opts.recipeStatus >= 400) {
        return jsonResponse(opts.recipeStatus, { error: 'recipe failed' });
      }
      return RECIPE;
    },
    'GET /api/pantry': () => {
      if (opts.pantryStatus && opts.pantryStatus >= 400) {
        return jsonResponse(opts.pantryStatus, { error: 'pantry failed' });
      }
      return PANTRY;
    },
    'GET /api/meal-plans/:id/cook-preview': ({ url }) => {
      const servings = Number(url.searchParams.get('servings') ?? state.servings);
      return { ...deductionPlan(servings), servings };
    },
    'PATCH /api/meal-plans/:id': ({ json }) => {
      const body = json<{ status?: MealPlanEntry['status'] }>();
      return {
        ...ENTRY,
        servings: String(state.servings),
        ...(body.status ? { status: body.status } : {}),
      };
    },
    'POST /api/meal-plans/:id/cook': ({ json }) => {
      if (opts.cookStatus === 409) return jsonResponse(409, { error: 'Meal plan entry already cooked' });
      if (opts.cookStatus && opts.cookStatus >= 400) {
        return jsonResponse(opts.cookStatus, { error: 'cook failed' });
      }
      const cooked = json<{ servings?: number }>().servings ?? state.servings;
      return {
        entry: {
          ...ENTRY,
          status: 'cooked' as const,
          servings: String(state.servings),
          actualServings: String(cooked),
        },
        ...deductionPlan(cooked),
      };
    },
    'POST /api/meal-plans/:id/feedback': ({ json }) => {
      if (opts.feedbackStatus === 409) {
        return jsonResponse(409, { error: 'Feedback already recorded' });
      }
      return jsonResponse(201, {
        id: 'fb1',
        mealPlanEntryId: 'e1',
        rating: 'thumbs_up',
        effortCheck: 'felt_right',
        makeAgain: 'yes',
        usedAsIs: true,
        changesNote: null,
        createdAt: '',
        updatedAt: '',
        ...json<Record<string, unknown>>(),
      });
    },
  });
}

let fetchMock: Mock = vi.fn();

/** Points the call inspectors at the current test's fetch mock. */
export function setFetchMock(m: Mock): void {
  fetchMock = m;
}

/** Calls whose URL contains `pattern`, optionally narrowed by HTTP method. */
export function callsMatching(pattern: string, method?: string): Array<[string, RequestInit | undefined]> {
  return (fetchMock.mock.calls as Array<[unknown, RequestInit | undefined]>)
    .filter((c): c is [string, RequestInit | undefined] => typeof c[0] === 'string')
    .filter(([url, init]) => url.includes(pattern) && (!method || (init?.method ?? 'GET') === method));
}

export function calledWith(pattern: string, method?: string): boolean {
  return callsMatching(pattern, method).length > 0;
}

export function lastBody(pattern: string, method?: string): Record<string, unknown> {
  const calls = callsMatching(pattern, method);
  const [, init] = calls[calls.length - 1]!;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}
