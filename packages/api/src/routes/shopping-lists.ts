import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { shoppingLists } from '@diet-app/db';
import { desc } from 'drizzle-orm';

export function shoppingListsRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/current', async (c) => {
    const row = await db.query.shoppingLists.findFirst({
      orderBy: desc(shoppingLists.createdAt),
      with: {
        items: {
          with: { ingredient: true },
        },
      },
    });
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  });

  return app;
}
