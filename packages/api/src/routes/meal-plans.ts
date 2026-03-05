import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { mealPlanEntries } from '@diet-app/db';
import { and, gte, lte } from 'drizzle-orm';

function getISOWeekBounds(dateStr: string): { monday: string; sunday: string } {
  const date = new Date(dateStr);
  const day = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    monday: monday.toISOString().slice(0, 10),
    sunday: sunday.toISOString().slice(0, 10),
  };
}

export function mealPlansRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/week/:date', async (c) => {
    const dateStr = c.req.param('date');
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
