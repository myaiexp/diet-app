// Shared fetch router for the meal plan screen suites.

import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, Recipe } from '../api/types.js';
import { jsonResponse, routeFetch } from './harness.js';
import { makeEntry } from './fixtures.js';

export const MONDAY = mondayOf(isoToday());

export interface RouterOpts {
  entries?: MealPlanEntry[];
  recipes?: Recipe[];
  /** When set, the week GET is keyed on `:monday` instead of a static array. */
  weekByMonday?: (monday: string) => MealPlanEntry[];
}

/** Routes: week GET, recipes GET, entry POST, cook-preview GET, cook POST, entry PATCH, pantry GET. */
export function buildRouter(opts: RouterOpts = {}) {
  const entries = opts.entries ?? [];
  const recipes = opts.recipes ?? [];
  let createdCount = 0;

  return routeFetch({
    'GET /api/meal-plans/week/:monday': ({ params }) => {
      const monday = params['monday']!;
      return opts.weekByMonday ? opts.weekByMonday(monday) : entries;
    },
    'GET /api/recipes': recipes,
    'POST /api/meal-plans': ({ json }) => {
      const body = json<Record<string, unknown>>();
      const entry = makeEntry({
        id: `new-${createdCount++}`,
        date: String(body['date'] ?? MONDAY),
        slot: (body['slot'] as MealPlanEntry['slot']) ?? 'breakfast',
        recipeId: (body['recipeId'] as string | undefined) ?? null,
        freeformNote: (body['freeformNote'] as string | undefined) ?? null,
        servings: String(body['servings'] ?? 1),
        status: 'planned',
      });
      return jsonResponse(201, entry);
    },
    'GET /api/meal-plans/:id/cook-preview': { deductions: [], shortfalls: [], servings: 4 },
    'POST /api/meal-plans/:id/cook': ({ params }) => {
      const id = params['id']!;
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return { entry: { ...base, status: 'cooked' as const }, deductions: [], shortfalls: [] };
    },
    'PATCH /api/meal-plans/:id': ({ params, json }) => {
      const id = params['id'];
      const body = json<Record<string, unknown>>();
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return { ...base, ...body, servings: String(body['servings'] ?? base.servings) };
    },
    'GET /api/pantry': [],
  });
}
