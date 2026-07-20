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

    const existing = await db.query.mealPlanEntries.findFirst({
      where: eq(mealPlanEntries.id, id),
    });
    if (!existing) return notFound(c);

    // cooked is terminal and only set via POST /:id/cook
    if (data.status !== undefined) {
      if (data.status === 'cooked' && existing.status !== 'cooked') {
        return conflict(c, 'Use POST /meal-plans/:id/cook to mark an entry cooked');
      }
      if (existing.status === 'cooked' && data.status !== 'cooked') {
        return conflict(c, 'Cooked meal plan entry status is immutable');
      }
    }

    const mergedRecipeId =
      data.recipeId !== undefined ? data.recipeId : existing.recipeId;
    const mergedNote =
      data.freeformNote !== undefined ? data.freeformNote : existing.freeformNote;
    if (!hasContent(mergedRecipeId, mergedNote)) {
      return badRequest(c, 'Validation failed', { formErrors: [CONTENT_MSG] });
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

    try {
      const [row] = await db
        .update(mealPlanEntries)
        .set(patch)
        .where(eq(mealPlanEntries.id, id))
        .returning();
      return c.json(row);
    } catch (err) {
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }
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
  // feedback mount lands in Task 6 — do NOT add feedback routes yet

  return app;
}
