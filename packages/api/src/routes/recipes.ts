import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { recipes } from '@diet-app/db';
import { eq, sql } from 'drizzle-orm';

export function recipesRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const tags = c.req.query('tags');
    const cuisine = c.req.query('cuisine');

    const rows = await db.query.recipes.findMany({
      where: (r, { eq, and }) => {
        const conditions = [];
        if (cuisine) conditions.push(eq(r.cuisineType, cuisine));
        if (tags) {
          conditions.push(sql`${r.tags} @> ARRAY[${tags}]::text[]`);
        }
        return conditions.length > 0 ? and(...conditions) : undefined;
      },
    });

    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await db.query.recipes.findFirst({
      where: eq(recipes.id, id),
      with: {
        recipeIngredients: {
          with: { ingredient: true },
        },
      },
    });
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  return app;
}
