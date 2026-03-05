import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { ingredients } from '@diet-app/db';
import { eq, ilike, and, or, sql } from 'drizzle-orm';

export function ingredientsRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const q = c.req.query('q');
    const category = c.req.query('category');

    const conditions = [];
    if (q) {
      conditions.push(
        or(
          ilike(ingredients.name, `%${q}%`),
          sql`EXISTS (SELECT 1 FROM unnest(${ingredients.aliases}) AS alias WHERE alias ILIKE ${`%${q}%`})`
        )
      );
    }
    if (category) {
      conditions.push(eq(ingredients.category, category));
    }

    const rows = conditions.length > 0
      ? await db.select().from(ingredients).where(and(...conditions))
      : await db.select().from(ingredients);

    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, id),
    });
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  return app;
}
