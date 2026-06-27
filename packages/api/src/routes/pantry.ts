import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { pantryItems } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { computeStatus } from '../pantry-status.js';

export function pantryRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const { limit, offset } = getPagination(c);
    const rows = await db.select().from(pantryItems).limit(limit).offset(offset);
    const withStatus = rows.map((row) => ({
      ...row,
      status: computeStatus(row.expiresDate),
    }));
    return c.json(withStatus);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'Invalid id format' }, 400);
    const row = await db.query.pantryItems.findFirst({
      where: eq(pantryItems.id, id),
    });
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...row, status: computeStatus(row.expiresDate) });
  });

  return app;
}
