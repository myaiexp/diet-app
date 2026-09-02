// POST /:id/cook — mark entry cooked and FEFO-deduct pantry stock
// GET /:id/cook-preview — the same plan, read-only, so the UI can show it first

import { Hono, type Context } from 'hono';
import type { Db } from '@diet-app/db';
import { mealPlanEntries, recipes, pantryItems } from '@diet-app/db';
import { eq, sql } from 'drizzle-orm';
import { isUuid, parseServings } from '../validation.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { mealPlanCookSchema } from '../schemas/meal-plans.js';
import type { Deduction, Shortfall } from '../cook-deduct.js';
import {
  loadCookPlan,
  stringifyDeductions,
  type CookPlanError,
} from '../cook-plan.js';

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

/** One mapping for both handlers, so preview and commit can never disagree. */
function planErrorResponse(c: Context, result: CookPlanError) {
  if (result.kind === 'not_found' || result.kind === 'recipe_not_found') {
    return notFound(c);
  }
  if (result.kind === 'already_cooked') {
    return conflict(c, 'Meal plan entry already cooked');
  }
  return badRequest(c, 'Invalid servings scale');
}

type CookOk = {
  kind: 'ok';
  entry: typeof mealPlanEntries.$inferSelect;
  deductions: Deduction[];
  shortfalls: Shortfall[];
};

export function mealPlanCookRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/:id/cook-preview', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    // Optional servings override — the modal's stepper re-previews with it, and
    // nothing is persisted, so the entry keeps its own value either way.
    const servingsRaw = c.req.query('servings');
    let servings: number | undefined;
    if (servingsRaw !== undefined) {
      const n = parseServings(servingsRaw);
      if (n === null) {
        return badRequest(c, 'Validation failed', {
          formErrors: ['Invalid servings query'],
        });
      }
      servings = n;
    }

    // Read-only: no transaction, no FOR UPDATE. A preview that locked rows would
    // stall real cooks, and the pantry may legitimately move before the commit —
    // the cook response, not this one, is the source of truth.
    const result = await loadCookPlan(db, id, { lock: false, ...(servings !== undefined ? { servings } : {}) });
    if (result.kind !== 'ok') return planErrorResponse(c, result);

    return c.json({
      deductions: stringifyDeductions(result.deductions),
      shortfalls: result.shortfalls,
      servings: result.servings,
    });
  });

  app.post('/:id/cook', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    // Body is optional: a client with nothing to override sends no bytes at all
    // (still with a JSON Content-Type, so csrfGuard doesn't 415 it).
    const parsed = await parseJsonBody(c, mealPlanCookSchema, { allowEmptyBody: true });
    if (!parsed.ok) return parsed.response;
    const override = parsed.data.servings;

    const result: CookOk | CookPlanError = await db.transaction(async (tx) => {
      const planned = await loadCookPlan(tx, id, {
        lock: true,
        ...(override !== undefined ? { servings: override } : {}),
      });
      if (planned.kind !== 'ok') return planned;

      if (planned.resolvedRecipeId != null) {
        // Apply planner output + bump timesCooked on the resolved recipe
        await applyDeductions(tx, planned.deductions);
        await tx
          .update(recipes)
          .set({ timesCooked: sql`${recipes.timesCooked} + 1` })
          .where(eq(recipes.id, planned.resolvedRecipeId));
      }

      // actualServings is what the deduction was actually computed from —
      // always recorded, even with no override, so a cooked row never has to be
      // read as "null means the planned figure". `servings` is left alone: it
      // stays the record of what was planned.
      const [updated] = await tx
        .update(mealPlanEntries)
        .set({
          status: 'cooked',
          actualServings: String(planned.servings),
          updatedAt: new Date(),
        })
        .where(eq(mealPlanEntries.id, id))
        .returning();

      return {
        kind: 'ok' as const,
        entry: updated,
        deductions: planned.deductions,
        shortfalls: planned.shortfalls,
      };
    });

    if (result.kind !== 'ok') return planErrorResponse(c, result);

    return c.json({
      entry: result.entry,
      deductions: stringifyDeductions(result.deductions),
      shortfalls: result.shortfalls,
    });
  });

  return app;
}
