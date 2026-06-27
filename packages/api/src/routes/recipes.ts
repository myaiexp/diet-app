import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { recipes } from '@diet-app/db';
import { eq, and } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { buildTagsCondition } from './recipe-filters.js';
import { notFound } from '../responses.js';

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
    if (!isUuid(id)) return c.json({ error: 'Invalid id format' }, 400);
    const row = await db.query.recipes.findFirst({
      where: eq(recipes.id, id),
      with: {
        recipeIngredients: {
          with: { ingredient: true },
        },
      },
    });
    if (!row) return notFound(c);
    return c.json(row);
  });

  return app;
}
