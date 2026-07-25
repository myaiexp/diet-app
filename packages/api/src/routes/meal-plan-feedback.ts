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

/** The two fields whose invariant ties them together: a note iff the cook changed something. */
interface FeedbackPair {
  usedAsIs: boolean;
  changesNote: string | null;
}

/**
 * The pair a patch resolves to. `usedAsIs: true` means "cooked as written", so
 * flipping it true drops the stored note — but only when the patch didn't name
 * a note itself: `{usedAsIs: true, changesNote: 'x'}` is a contradiction the
 * caller has to hear about, not have silently repaired.
 *
 * Computing this once is what keeps the accepted body and the persisted row
 * from drifting: the handler validates this value and writes this same value.
 */
function mergeFeedback(existing: FeedbackPair, patch: FeedbackPatch): FeedbackPair {
  const usedAsIs = patch.usedAsIs ?? existing.usedAsIs;
  if (patch.changesNote !== undefined) return { usedAsIs, changesNote: patch.changesNote };
  return { usedAsIs, changesNote: usedAsIs ? null : existing.changesNote };
}

function isValidFeedbackPair({ usedAsIs, changesNote }: FeedbackPair): boolean {
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

    const merged = mergeFeedback(existing, data);
    if (!isValidFeedbackPair(merged)) {
      return badRequest(c, 'Validation failed', {
        formErrors: [
          merged.usedAsIs
            ? 'changesNote must be absent when usedAsIs is true'
            : 'changesNote is required when usedAsIs is false',
        ],
      });
    }

    // Persist exactly the pair that was validated: buildPatch carries the
    // rating fields, `merged` owns usedAsIs/changesNote.
    const patch: Partial<typeof cookFeedback.$inferInsert> = {
      ...buildPatch(data, cookFeedback),
      ...merged,
      updatedAt: new Date(),
    };

    const [row] = await db
      .update(cookFeedback)
      .set(patch)
      .where(eq(cookFeedback.id, existing.id))
      .returning();

    return c.json(row);
  });

  return app;
}
