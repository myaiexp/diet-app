// Meal plan entry week GET + POST/PATCH/DELETE; mounts cook/feedback sub-routers

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { mealPlanEntries, cookFeedback } from '@diet-app/db';
import { and, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { getISOWeekBounds } from '../date.js';
import { isIsoDate, isUuid } from '../validation.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { readJsonBody } from '../json-body.js';
import { isFkViolation } from '../pg-errors.js';
import {
  mealPlanCreateSchema,
  mealPlanPatchSchema,
  CONTENT_MSG,
  type MealPlanPatch,
} from '../schemas/meal-plans.js';
import { mealPlanCookRoutes } from './meal-plan-cook.js';
import { mealPlanFeedbackRoutes } from './meal-plan-feedback.js';

function hasContent(
  recipeId: string | null | undefined,
  freeformNote: string | null | undefined,
): boolean {
  return recipeId != null || (freeformNote != null && freeformNote !== '');
}

export function mealPlansRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/week/:date', async (c) => {
    const dateStr = c.req.param('date');
    if (!isIsoDate(dateStr)) return c.json({ error: 'Invalid date format' }, 400);
    const { monday, sunday } = getISOWeekBounds(dateStr);

    const rows = await db.select().from(mealPlanEntries).where(
      and(
        gte(mealPlanEntries.date, monday),
        lte(mealPlanEntries.date, sunday)
      )
    );

    return c.json(rows);
  });

  app.post('/', async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = mealPlanCreateSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
    const data = parsed.data;

    try {
      const [row] = await db
        .insert(mealPlanEntries)
        .values({
          date: data.date,
          slot: data.slot,
          recipeId: data.recipeId ?? null,
          freeformNote: data.freeformNote ?? null,
          servings: String(data.servings ?? 1),
          status: data.status ?? 'planned',
          substituteRecipeId: data.substituteRecipeId ?? null,
          notes: data.notes ?? null,
        })
        .returning();

      return c.json(row, 201);
    } catch (err) {
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = mealPlanPatchSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
    const data: MealPlanPatch = parsed.data;
    if (Object.keys(data).length === 0) {
      return badRequest(c, 'Validation failed', { formErrors: ['Empty patch body'] });
    }

    type PatchOk = { kind: 'ok'; row: typeof mealPlanEntries.$inferSelect };
    type PatchErr =
      | { kind: 'not_found' }
      | { kind: 'cook_owned' }
      | { kind: 'cooked_immutable' }
      | { kind: 'cooked_inputs_immutable' }
      | { kind: 'no_content' }
      | { kind: 'fk' };

    let result: PatchOk | PatchErr;
    try {
      // FOR UPDATE so a concurrent cook cannot be overwritten after our guards
      result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(mealPlanEntries)
          .where(eq(mealPlanEntries.id, id))
          .for('update');
        if (!existing) return { kind: 'not_found' as const };

        // cooked is terminal and only set via POST /:id/cook
        if (data.status !== undefined) {
          if (data.status === 'cooked' && existing.status !== 'cooked') {
            return { kind: 'cook_owned' as const };
          }
          if (existing.status === 'cooked' && data.status !== 'cooked') {
            return { kind: 'cooked_immutable' as const };
          }
        }

        // The cook deducted pantry stock from (substituteRecipeId ?? recipeId)
        // scaled by servings. Changing any of those three afterwards would leave
        // the entry claiming a meal that was never cooked that way, and the cook
        // route 409s on a cooked entry so it cannot be re-run to reconcile.
        // Re-sending an unchanged value is fine — only real changes are blocked.
        if (existing.status === 'cooked') {
          const changesCookInputs =
            (data.recipeId !== undefined && data.recipeId !== existing.recipeId) ||
            (data.substituteRecipeId !== undefined &&
              data.substituteRecipeId !== existing.substituteRecipeId) ||
            (data.servings !== undefined &&
              Number(data.servings) !== Number(existing.servings));
          if (changesCookInputs) {
            return { kind: 'cooked_inputs_immutable' as const };
          }
        }

        const mergedRecipeId =
          data.recipeId !== undefined ? data.recipeId : existing.recipeId;
        const mergedNote =
          data.freeformNote !== undefined ? data.freeformNote : existing.freeformNote;
        if (!hasContent(mergedRecipeId, mergedNote)) {
          return { kind: 'no_content' as const };
        }

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (data.date !== undefined) patch.date = data.date;
        if (data.slot !== undefined) patch.slot = data.slot;
        if (data.recipeId !== undefined) patch.recipeId = data.recipeId;
        if (data.freeformNote !== undefined) patch.freeformNote = data.freeformNote;
        if (data.servings !== undefined) patch.servings = String(data.servings);
        if (data.status !== undefined) patch.status = data.status;
        if (data.substituteRecipeId !== undefined) {
          patch.substituteRecipeId = data.substituteRecipeId;
        }
        if (data.notes !== undefined) patch.notes = data.notes;

        const [row] = await tx
          .update(mealPlanEntries)
          .set(patch)
          .where(eq(mealPlanEntries.id, id))
          .returning();
        return { kind: 'ok' as const, row };
      });
    } catch (err) {
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }

    if (result.kind === 'not_found') return notFound(c);
    if (result.kind === 'cook_owned') {
      return conflict(c, 'Use POST /meal-plans/:id/cook to mark an entry cooked');
    }
    if (result.kind === 'cooked_immutable') {
      return conflict(c, 'Cooked meal plan entry status is immutable');
    }
    if (result.kind === 'cooked_inputs_immutable') {
      return conflict(c, 'Cooked meal plan entry recipe and servings are immutable');
    }
    if (result.kind === 'no_content') {
      return badRequest(c, 'Validation failed', { formErrors: [CONTENT_MSG] });
    }
    return c.json(result.row);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const existing = await db.query.mealPlanEntries.findFirst({
      where: eq(mealPlanEntries.id, id),
    });
    if (!existing) return notFound(c);

    const feedback = await db
      .select({ id: cookFeedback.id })
      .from(cookFeedback)
      .where(eq(cookFeedback.mealPlanEntryId, id))
      .limit(1);
    if (feedback.length > 0) {
      return conflict(c, 'Meal plan entry has cook feedback');
    }

    try {
      await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, id));
    } catch (err) {
      // Race: feedback inserted between pre-check and delete.
      if (isFkViolation(err)) {
        return conflict(c, 'Meal plan entry has cook feedback');
      }
      throw err;
    }
    return c.body(null, 204);
  });

  app.route('/', mealPlanCookRoutes(db));
  app.route('/', mealPlanFeedbackRoutes(db));

  return app;
}
