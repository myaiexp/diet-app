import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { pantryItems } from '@diet-app/db';
import { eq } from 'drizzle-orm';

type PantryStatus = 'fresh' | 'use_soon' | 'use_today' | 'expired';

function computeStatus(expiresDate: string): PantryStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expires = new Date(expiresDate);
  expires.setHours(0, 0, 0, 0);
  const diffDays = (expires.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 'expired';
  if (diffDays <= 1) return 'use_today';
  if (diffDays <= 3) return 'use_soon';
  return 'fresh';
}

export function pantryRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const rows = await db.select().from(pantryItems);
    const withStatus = rows.map((row) => ({
      ...row,
      status: computeStatus(row.expiresDate),
    }));
    return c.json(withStatus);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await db.query.pantryItems.findFirst({
      where: eq(pantryItems.id, id),
    });
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...row, status: computeStatus(row.expiresDate) });
  });

  return app;
}
