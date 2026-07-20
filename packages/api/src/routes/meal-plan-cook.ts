// POST /:id/cook — mark entry cooked and FEFO-deduct pantry stock

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { mealPlanEntries, recipes, recipeIngredients, pantryItems } from '@diet-app/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { notFound, badRequest, conflict } from '../responses.js';
import {
  planDeduction,
  type Deduction,
  type Shortfall,
  type RecipeLine,
  type PantryRow,
} from '../cook-deduct.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function applyDeductions(tx: Tx, deductions: Deduction[]): Promise<void> {
  const now = new Date();
  for (const d of deductions) {
    for (const item of d.pantryItems) {
      if (item.deleted) {
        await tx.delete(pantryItems).where(eq(pantryItems.id, item.id));
      } else {
        await tx
          .update(pantryItems)
          .set({ quantity: String(item.after), updatedAt: now })
          .where(eq(pantryItems.id, item.id));
      }
    }
  }
}

function stringifyDeductions(deductions: Deduction[]) {
  return deductions.map((d) => ({
    ...d,
    pantryItems: d.pantryItems.map((p) => ({
      ...p,
      before: String(p.before),
      after: String(p.after),
    })),
  }));
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

type CookOk = {
  kind: 'ok';
  entry: typeof mealPlanEntries.$inferSelect;
  deductions: Deduction[];
  shortfalls: Shortfall[];
};
type CookErr =
  | { kind: 'not_found' }
  | { kind: 'already_cooked' }
  | { kind: 'recipe_not_found' }
  | { kind: 'bad_scale' };

export function mealPlanCookRoutes(db: Db): Hono {
  const app = new Hono();

  app.post('/:id/cook', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const result: CookOk | CookErr = await db.transaction(async (tx) => {
      // 1. Lock the entry
      const [entry] = await tx
        .select()
        .from(mealPlanEntries)
        .where(eq(mealPlanEntries.id, id))
        .for('update');
      if (!entry) return { kind: 'not_found' };
      if (entry.status === 'cooked') return { kind: 'already_cooked' };

      // 2. Resolve recipe (substitute wins); freeform → empty plan, step 6
      const resolvedRecipeId = entry.substituteRecipeId ?? entry.recipeId;
      let deductions: Deduction[] = [];
      let shortfalls: Shortfall[] = [];

      if (resolvedRecipeId != null) {
        // 3. Load recipe + lines + candidate pantry rows (FOR UPDATE)
        const [recipe] = await tx
          .select()
          .from(recipes)
          .where(eq(recipes.id, resolvedRecipeId));
        if (!recipe) return { kind: 'recipe_not_found' };

        const lines = await tx
          .select()
          .from(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, resolvedRecipeId));

        const ingredientIds = [...new Set(lines.map((l) => l.ingredientId))];
        const pantryDbRows =
          ingredientIds.length === 0
            ? []
            : await tx
                .select()
                .from(pantryItems)
                .where(inArray(pantryItems.ingredientId, ingredientIds))
                .orderBy(asc(pantryItems.id))
                .for('update');

        // 4. Scale and plan (all arithmetic lives in cook-deduct)
        const scale = Number(entry.servings) / recipe.servings;
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
        deductions = planned.deductions;
        shortfalls = planned.shortfalls;

        // 5. Apply planner output + bump timesCooked on the resolved recipe
        await applyDeductions(tx, deductions);
        await tx
          .update(recipes)
          .set({ timesCooked: sql`${recipes.timesCooked} + 1` })
          .where(eq(recipes.id, resolvedRecipeId));
      }

      // 6. Mark cooked
      const [updated] = await tx
        .update(mealPlanEntries)
        .set({ status: 'cooked', updatedAt: new Date() })
        .where(eq(mealPlanEntries.id, id))
        .returning();

      return { kind: 'ok', entry: updated, deductions, shortfalls };
    });

    if (result.kind === 'not_found' || result.kind === 'recipe_not_found') {
      return notFound(c);
    }
    if (result.kind === 'already_cooked') {
      return conflict(c, 'Meal plan entry already cooked');
    }
    if (result.kind === 'bad_scale') {
      return badRequest(c, 'Invalid servings scale');
    }

    return c.json({
      entry: result.entry,
      deductions: stringifyDeductions(result.deductions),
      shortfalls: result.shortfalls,
    });
  });

  return app;
}
