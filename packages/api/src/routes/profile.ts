// Profile GET (with disliked ids) and PATCH for singleton user_profile

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { userProfile, userDislikedIngredients, ingredients } from '@diet-app/db';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { notFound, badRequest } from '../responses.js';
import { readJsonBody } from '../json-body.js';
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
    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = profilePatchSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
    const data = parsed.data;
    if (Object.keys(data).length === 0) {
      return badRequest(c, 'Validation failed', { formErrors: ['Empty patch body'] });
    }

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

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.calorieTargetMin !== undefined) updates.calorieTargetMin = data.calorieTargetMin;
    if (data.calorieTargetMax !== undefined) updates.calorieTargetMax = data.calorieTargetMax;
    if (data.macroTargets !== undefined) updates.macroTargets = data.macroTargets;
    if (data.dietaryRestrictions !== undefined) updates.dietaryRestrictions = data.dietaryRestrictions;
    if (data.cookingSkill !== undefined) updates.cookingSkill = data.cookingSkill;
    if (data.kitchenEquipment !== undefined) updates.kitchenEquipment = data.kitchenEquipment;
    if (data.householdSize !== undefined) updates.householdSize = data.householdSize;
    if (data.scheduleProfile !== undefined) updates.scheduleProfile = data.scheduleProfile;

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
          await tx.update(userProfile).set(updates).where(eq(userProfile.id, existing.id));
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
        await db.update(userProfile).set(updates).where(eq(userProfile.id, existing.id));
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
