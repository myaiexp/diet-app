// Shared fetch router for the Today screen suites.

import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, PantryItem, Recipe } from '../api/types.js';
import { jsonResponse, routeFetch } from './harness.js';
import { makeEntry, makeFeedback } from './fixtures.js';

export const TODAY = isoToday();
export const MONDAY = mondayOf(TODAY);

export interface RouterOpts {
  entries?: MealPlanEntry[];
  pantry?: PantryItem[];
  recipes?: Recipe[];
  /** Entry ids whose GET .../feedback resolves 200; anything else 404s. */
  ratedEntryIds?: string[];
}

/** Routes: week GET, pantry GET, recipes GET, per-entry feedback GET, cook-preview/cook. */
export function buildRouter(opts: RouterOpts = {}) {
  const entries = opts.entries ?? [];
  const pantry = opts.pantry ?? [];
  const recipes = opts.recipes ?? [];
  const rated = new Set(opts.ratedEntryIds ?? []);

  return routeFetch({
    [`GET /api/meal-plans/week/${MONDAY}`]: entries,
    'GET /api/pantry': pantry,
    'GET /api/recipes': recipes,
    'GET /api/meal-plans/:id/feedback': ({ params }) => {
      const id = params['id']!;
      if (rated.has(id)) return jsonResponse(200, makeFeedback(id));
      return jsonResponse(404, { error: 'Not found' });
    },
    'GET /api/meal-plans/:id/cook-preview': { deductions: [], shortfalls: [], servings: 4 },
    'POST /api/meal-plans/:id/cook': ({ params }) => {
      const id = params['id']!;
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return { entry: { ...base, status: 'cooked' as const }, deductions: [], shortfalls: [] };
    },
  });
}
