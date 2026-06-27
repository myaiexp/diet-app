import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { mealPlanEntries } from '@diet-app/db';
import { and, gte, lte } from 'drizzle-orm';
import { getISOWeekBounds } from '../date.js';
import { isIsoDate } from '../validation.js';

export function mealPlansRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/week/:date', async (c) => {
    const dateStr = c.req.param('date');
    if (!isIsoDate(dateStr)) return c.json({ error: 'Invalid date format' }, 400);
    const { monday, sunday } = getISOWeekBounds(dateStr);

    const rows = await db.select().from(mealPlanEntries).where(
      and(
        gte(mealPlanEntries.date, monday),
        lte(mealPlanEntries.date, sunday)
      )
    );

    return c.json(rows);
  });

  return app;
}
