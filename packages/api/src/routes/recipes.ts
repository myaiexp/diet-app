// Recipe CRUD routes (list/get + create/update/delete with ingredients)

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { recipes, recipeIngredients, mealPlanEntries } from '@diet-app/db';
import { eq, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { buildTagsCondition } from './recipe-filters.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { readJsonBody } from '../json-body.js';
import {
  recipeCreateSchema,
  recipePatchSchema,
  type RecipeIngredientLine,
} from '../schemas/recipes.js';
import { isFkViolation } from '../pg-errors.js';

async function loadRecipeWithIngredients(db: Db, id: string) {
  return db.query.recipes.findFirst({
    where: eq(recipes.id, id),
    with: {
      recipeIngredients: {
        with: { ingredient: true },
      },
    },
  });
}

function lineValues(recipeId: string, lines: RecipeIngredientLine[]) {
  return lines.map((line) => ({
    recipeId,
    ingredientId: line.ingredientId,
    quantity: String(line.quantity),
    unit: line.unit,
    optional: line.optional ?? false,
    notes: line.notes ?? null,
  }));
}

export function recipesRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const tags = c.req.query('tags');
    const cuisine = c.req.query('cuisine');

    const conditions = [];
    if (cuisine) conditions.push(eq(recipes.cuisineType, cuisine));
    if (tags) {
      const tagsCondition = buildTagsCondition(tags);
      if (tagsCondition) conditions.push(tagsCondition);
    }

    const { limit, offset } = getPagination(c);
    const rows = await db
      .select()
      .from(recipes)
      .where(conditions.length ? and(...conditions) : undefined)
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');
    const row = await loadRecipeWithIngredients(db, id);
    if (!row) return notFound(c);
    return c.json(row);
  });

  app.post('/', async (c) => {
    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = recipeCreateSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
    const data = parsed.data;

    try {
      const created = await db.transaction(async (tx) => {
        const [recipe] = await tx
          .insert(recipes)
          .values({
            title: data.title,
            sourceType: data.sourceType ?? 'manual',
            sourceUrl: data.sourceUrl ?? null,
            parentRecipeId: data.parentRecipeId ?? null,
            steps: data.steps ?? [],
            prepTime: data.prepTime ?? null,
            totalTime: data.totalTime ?? null,
            servings: data.servings ?? 1,
            effortScore: data.effortScore ?? null,
            tags: data.tags ?? [],
            cuisineType: data.cuisineType ?? null,
          })
          .returning();

        await tx.insert(recipeIngredients).values(lineValues(recipe.id, data.ingredients));
        return recipe;
      });

      const full = await loadRecipeWithIngredients(db, created.id);
      if (!full) return notFound(c);
      return c.json(full, 201);
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

    const parsed = recipePatchSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
    const data = parsed.data;
    if (Object.keys(data).length === 0) {
      return badRequest(c, 'Validation failed', { formErrors: ['Empty patch body'] });
    }

    const existing = await db.query.recipes.findFirst({ where: eq(recipes.id, id) });
    if (!existing) return notFound(c);

    const header: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) header.title = data.title;
    if (data.sourceType !== undefined) header.sourceType = data.sourceType;
    if (data.sourceUrl !== undefined) header.sourceUrl = data.sourceUrl;
    if (data.parentRecipeId !== undefined) header.parentRecipeId = data.parentRecipeId;
    if (data.steps !== undefined) header.steps = data.steps;
    if (data.prepTime !== undefined) header.prepTime = data.prepTime;
    if (data.totalTime !== undefined) header.totalTime = data.totalTime;
    if (data.servings !== undefined) header.servings = data.servings;
    if (data.effortScore !== undefined) header.effortScore = data.effortScore;
    if (data.tags !== undefined) header.tags = data.tags;
    if (data.cuisineType !== undefined) header.cuisineType = data.cuisineType;

    try {
      await db.transaction(async (tx) => {
        await tx.update(recipes).set(header).where(eq(recipes.id, id));

        if (data.ingredients !== undefined) {
          await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
          await tx.insert(recipeIngredients).values(lineValues(id, data.ingredients));
        }
      });
    } catch (err) {
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }

    const full = await loadRecipeWithIngredients(db, id);
    if (!full) return notFound(c);
    return c.json(full);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const existing = await db.query.recipes.findFirst({ where: eq(recipes.id, id) });
    if (!existing) return notFound(c);

    const mealRefs = await db
      .select({ id: mealPlanEntries.id })
      .from(mealPlanEntries)
      .where(
        or(eq(mealPlanEntries.recipeId, id), eq(mealPlanEntries.substituteRecipeId, id)),
      )
      .limit(1);
    if (mealRefs.length > 0) {
      return conflict(c, 'Recipe is referenced by meal plan entries');
    }

    const children = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.parentRecipeId, id))
      .limit(1);
    if (children.length > 0) {
      return conflict(c, 'Recipe has forked child recipes');
    }

    try {
      await db.transaction(async (tx) => {
        await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
        await tx.delete(recipes).where(eq(recipes.id, id));
      });
    } catch (err) {
      if (isFkViolation(err)) {
        return conflict(c, 'Recipe is referenced by meal plan entries');
      }
      throw err;
    }

    return c.body(null, 204);
  });

  return app;
}
