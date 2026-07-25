// Profile GET (with disliked ids) and PATCH for singleton user_profile

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { userProfile, userDislikedIngredients, ingredients } from '@diet-app/db';
import { eq, inArray } from 'drizzle-orm';
import { notFound, badRequest } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { buildPatch } from '../patch-builder.js';
import { profilePatchSchema } from '../schemas/profile.js';
import { isFkViolation } from '../pg-errors.js';

async function loadDislikedIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ ingredientId: userDislikedIngredients.ingredientId })
    .from(userDislikedIngredients)
    .where(eq(userDislikedIngredients.userId, userId));
  return rows.map((r) => r.ingredientId).sort();
}

async function profileResponse(db: Db, row: typeof userProfile.$inferSelect) {
  const dislikedIngredientIds = await loadDislikedIds(db, row.id);
  return { ...row, dislikedIngredientIds };
}

function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function profileRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const row = await db.query.userProfile.findFirst();
    if (!row) return notFound(c);
    return c.json(await profileResponse(db, row));
  });

  app.patch('/', async (c) => {
    const parsed = await parseJsonBody(c, profilePatchSchema, { requireNonEmpty: true });
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    const existing = await db.query.userProfile.findFirst();
    if (!existing) return notFound(c);

    const nextMin =
      data.calorieTargetMin !== undefined ? data.calorieTargetMin : existing.calorieTargetMin;
    const nextMax =
      data.calorieTargetMax !== undefined ? data.calorieTargetMax : existing.calorieTargetMax;
    if (nextMin != null && nextMax != null && nextMin > nextMax) {
      return badRequest(c, 'Validation failed', {
        formErrors: ['calorieTargetMin must be ≤ calorieTargetMax'],
      });
    }

    // `dislikedIngredientIds` is not a user_profile column — the junction table
    // is replaced in the transaction below.
    const patch: Partial<typeof userProfile.$inferInsert> = {
      ...buildPatch(data, userProfile),
      updatedAt: new Date(),
    };

    try {
      if (data.dislikedIngredientIds !== undefined) {
        const uniqueIds = dedupeIds(data.dislikedIngredientIds);

        if (uniqueIds.length > 0) {
          const found = await db
            .select({ id: ingredients.id })
            .from(ingredients)
            .where(inArray(ingredients.id, uniqueIds));
          if (found.length !== uniqueIds.length) {
            return badRequest(c, 'Invalid reference');
          }
        }

        await db.transaction(async (tx) => {
          await tx.update(userProfile).set(patch).where(eq(userProfile.id, existing.id));
          await tx
            .delete(userDislikedIngredients)
            .where(eq(userDislikedIngredients.userId, existing.id));
          if (uniqueIds.length > 0) {
            await tx.insert(userDislikedIngredients).values(
              uniqueIds.map((ingredientId) => ({
                userId: existing.id,
                ingredientId,
              })),
            );
          }
        });
      } else {
        await db.update(userProfile).set(patch).where(eq(userProfile.id, existing.id));
      }
    } catch (err) {
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }

    const row = await db.query.userProfile.findFirst({ where: eq(userProfile.id, existing.id) });
    if (!row) return notFound(c);
    return c.json(await profileResponse(db, row));
  });

  return app;
}
