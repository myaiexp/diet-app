// Load a meal plan entry and plan its FEFO deduction (shared by cook + preview)

import type { Db } from '@diet-app/db';
import { mealPlanEntries, recipes, recipeIngredients, pantryItems } from '@diet-app/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { parseServings } from './validation.js';
import {
  planDeduction,
  type Deduction,
  type Shortfall,
  type RecipeLine,
  type PantryRow,
} from './cook-deduct.js';

/** Anything that can run a select: the db handle, or a transaction. */
export type CookReader = Pick<Db, 'select'>;

export interface CookPlanOk {
  kind: 'ok';
  entry: typeof mealPlanEntries.$inferSelect;
  /** substituteRecipeId ?? recipeId — null for a freeform entry. */
  resolvedRecipeId: string | null;
  /** Servings the plan was computed for (override, else the entry's own). */
  servings: number;
  deductions: Deduction[];
  shortfalls: Shortfall[];
}

export type CookPlanError =
  | { kind: 'not_found' }
  | { kind: 'already_cooked' }
  | { kind: 'recipe_not_found' }
  | { kind: 'bad_scale' };

export type CookPlanResult = CookPlanOk | CookPlanError;

export interface LoadCookPlanOpts {
  /**
   * FOR UPDATE on the entry and the candidate pantry rows. The commit path locks
   * so a concurrent cook can't deduct the same stock twice; the preview must not
   * — a read-only endpoint that holds row locks would stall real cooks.
   */
  lock: boolean;
  /** Plan for these servings instead of the entry's stored value (preview only). */
  servings?: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Read the entry, resolve its recipe (substitute wins), and plan the deduction.
 * Writes nothing — the caller applies the plan, or discards it for a preview.
 */
export async function loadCookPlan(
  reader: CookReader,
  id: string,
  opts: LoadCookPlanOpts,
): Promise<CookPlanResult> {
  const entryQuery = reader
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.id, id));
  const [entry] = await (opts.lock ? entryQuery.for('update') : entryQuery);
  if (!entry) return { kind: 'not_found' };
  if (entry.status === 'cooked') return { kind: 'already_cooked' };

  const servings = opts.servings ?? Number(entry.servings);
  if (parseServings(servings) === null) return { kind: 'bad_scale' };
  const resolvedRecipeId = entry.substituteRecipeId ?? entry.recipeId;
  if (resolvedRecipeId == null) {
    // Freeform entry: nothing to deduct, but it still cooks.
    return {
      kind: 'ok',
      entry,
      resolvedRecipeId: null,
      servings,
      deductions: [],
      shortfalls: [],
    };
  }

  const [recipe] = await reader
    .select()
    .from(recipes)
    .where(eq(recipes.id, resolvedRecipeId));
  if (!recipe) return { kind: 'recipe_not_found' };

  const lines = await reader
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, resolvedRecipeId));

  const ingredientIds = [...new Set(lines.map((l) => l.ingredientId))];
  let pantryDbRows: Array<typeof pantryItems.$inferSelect> = [];
  if (ingredientIds.length > 0) {
    const pantryQuery = reader
      .select()
      .from(pantryItems)
      .where(inArray(pantryItems.ingredientId, ingredientIds))
      .orderBy(asc(pantryItems.id));
    pantryDbRows = await (opts.lock ? pantryQuery.for('update') : pantryQuery);
  }

  const scale = servings / recipe.servings;
  if (!Number.isFinite(scale)) return { kind: 'bad_scale' };

  const recipeLines: RecipeLine[] = lines.map((l) => ({
    ingredientId: l.ingredientId,
    quantity: Number(l.quantity),
    unit: l.unit,
    optional: l.optional ?? false,
  }));
  const pantryForPlanner: PantryRow[] = pantryDbRows.map((r) => ({
    id: r.id,
    ingredientId: r.ingredientId,
    quantity: Number(r.quantity),
    unit: r.unit,
    expiresDate: r.expiresDate,
    opened: r.opened ?? false,
    createdAt: toIso(r.createdAt),
  }));

  const planned = planDeduction(recipeLines, pantryForPlanner, scale);
  return {
    kind: 'ok',
    entry,
    resolvedRecipeId,
    servings,
    deductions: planned.deductions,
    shortfalls: planned.shortfalls,
  };
}

/** Stringify planner quantities like every other numeric column in the API. */
export function stringifyDeductions(deductions: Deduction[]) {
  return deductions.map((d) => ({
    ...d,
    pantryItems: d.pantryItems.map((p) => ({
      ...p,
      before: String(p.before),
      after: String(p.after),
    })),
  }));
}
