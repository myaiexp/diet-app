import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { shoppingLists } from '@diet-app/db';
import { desc, lte } from 'drizzle-orm';

export function shoppingListsRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/current', async (c) => {
    // "Current" = the list whose week has most recently started (week_starting on
    // or before today), ordered newest-first — not the most recently *created*
    // row. Ordering by createdAt would let a list drafted in advance for a future
    // week shadow the one actually covering the current week. The <= today filter
    // also excludes future-week drafts entirely.
    const today = new Date().toISOString().slice(0, 10);
    const row = await db.query.shoppingLists.findFirst({
      where: lte(shoppingLists.weekStarting, today),
      orderBy: desc(shoppingLists.weekStarting),
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
