// GET/POST/PATCH /:id/feedback — 1:1 cook feedback for meal plan entries

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { mealPlanEntries, cookFeedback } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { buildPatch } from '../patch-builder.js';
import { isFkViolation, isUniqueViolation } from '../pg-errors.js';
import {
  feedbackCreateSchema,
  feedbackPatchSchema,
  type FeedbackPatch,
} from '../schemas/meal-plans.js';

function mergedUsedAsIsValid(
  usedAsIs: boolean,
  changesNote: string | null | undefined,
): boolean {
  if (usedAsIs === false) {
    return changesNote != null && changesNote !== '';
  }
  return changesNote == null;
}

export function mealPlanFeedbackRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/:id/feedback', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const row = await db.query.cookFeedback.findFirst({
      where: eq(cookFeedback.mealPlanEntryId, id),
    });
    if (!row) return notFound(c);
    return c.json(row);
  });

  app.post('/:id/feedback', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const parsed = await parseJsonBody(c, feedbackCreateSchema);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    const entry = await db.query.mealPlanEntries.findFirst({
      where: eq(mealPlanEntries.id, id),
    });
    if (!entry) return notFound(c);
    if (entry.status !== 'cooked') {
      return conflict(c, 'Meal plan entry is not cooked');
    }

    const existing = await db.query.cookFeedback.findFirst({
      where: eq(cookFeedback.mealPlanEntryId, id),
    });
    if (existing) {
      return conflict(c, 'Feedback already exists for this meal plan entry');
    }

    try {
      const [row] = await db
        .insert(cookFeedback)
        .values({
          mealPlanEntryId: id,
          rating: data.rating,
          effortCheck: data.effortCheck,
          makeAgain: data.makeAgain,
          usedAsIs: data.usedAsIs,
          changesNote: data.usedAsIs ? null : (data.changesNote ?? null),
        })
        .returning();
      return c.json(row, 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return conflict(c, 'Feedback already exists for this meal plan entry');
      }
      // Race: entry deleted between pre-check and insert
      if (isFkViolation(err)) return notFound(c);
      throw err;
    }
  });

  app.patch('/:id/feedback', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const parsed = await parseJsonBody(c, feedbackPatchSchema, { requireNonEmpty: true });
    if (!parsed.ok) return parsed.response;
    const data: FeedbackPatch = parsed.data;

    const existing = await db.query.cookFeedback.findFirst({
      where: eq(cookFeedback.mealPlanEntryId, id),
    });
    if (!existing) return notFound(c);

    const mergedUsedAsIs =
      data.usedAsIs !== undefined ? data.usedAsIs : existing.usedAsIs;
    // Flipping to usedAsIs:true auto-clears the note (see patch write below), so
    // treat an omitted changesNote as null when validating the merge.
    let mergedNote =
      data.changesNote !== undefined ? data.changesNote : existing.changesNote;
    if (mergedUsedAsIs === true && data.changesNote === undefined) {
      mergedNote = null;
    }
    if (!mergedUsedAsIsValid(mergedUsedAsIs, mergedNote)) {
      return badRequest(c, 'Validation failed', {
        formErrors: [
          mergedUsedAsIs
            ? 'changesNote must be absent when usedAsIs is true'
            : 'changesNote is required when usedAsIs is false',
        ],
      });
    }

    const patch: Partial<typeof cookFeedback.$inferInsert> = {
      ...buildPatch(data, cookFeedback),
      updatedAt: new Date(),
    };
    // When usedAsIs is true and note not supplied, force null (matches merge rule)
    if (mergedUsedAsIs === true && data.changesNote === undefined) {
      patch.changesNote = null;
    }

    const [row] = await db
      .update(cookFeedback)
      .set(patch)
      .where(eq(cookFeedback.id, existing.id))
      .returning();

    return c.json(row);
  });

  return app;
}
