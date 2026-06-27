import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { notFound } from '../responses.js';

export function profileRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const row = await db.query.userProfile.findFirst();
    if (!row) return notFound(c);
    return c.json(row);
  });

  return app;
}
