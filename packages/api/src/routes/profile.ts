import { Hono } from 'hono';
import type { Db } from '@diet-app/db';

export function profileRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const row = await db.query.userProfile.findFirst();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  return app;
}
