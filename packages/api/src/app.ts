import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from '@diet-app/db';

export function createApp(db: Db) {
  const app = new Hono();

  app.use('*', cors({ origin: '*' }));

  app.get('/api/health', (c) => c.json({ ok: true, name: 'diet-app-api' }));

  // Route mounting points — stubs added in Task 7

  return app;
}
