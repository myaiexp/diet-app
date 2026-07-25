import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { ingredients } from '@diet-app/db';
import { eq, ilike, and, or, sql, asc } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { notFound, badRequest } from '../responses.js';

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

    const { limit, offset } = getPagination(c);
    const rows = await db
      .select()
      .from(ingredients)
      .where(conditions.length ? and(...conditions) : undefined)
      // Alphabetical catalog browse. The id tie-break is what makes paging
      // safe: without a total order Postgres may return the same row on two
      // pages and never return another (see the ordering rule in CLAUDE.md).
      .orderBy(asc(ingredients.name), asc(ingredients.id))
      .limit(limit)
      .offset(offset);

    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');
    const row = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, id),
    });
    if (!row) return notFound(c);
    return c.json(row);
  });

  return app;
}
