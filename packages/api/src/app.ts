import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from '@diet-app/db';
import { bearerAuth } from './auth.js';
import { ingredientsRoutes } from './routes/ingredients.js';
import { recipesRoutes } from './routes/recipes.js';
import { pantryRoutes } from './routes/pantry.js';
import { mealPlansRoutes } from './routes/meal-plans.js';
import { shoppingListsRoutes } from './routes/shopping-lists.js';
import { profileRoutes } from './routes/profile.js';
import type { AiConfig } from './config.js';

export interface AppConfig {
  // When set, every /api/* route except /api/health requires `Bearer <authToken>`.
  // Omitted in unit tests so route logic can be exercised without a token.
  authToken?: string;
  // Allowed CORS origins. Defaults to dev origins; production passes a narrowed
  // list from CORS_ORIGINS (see config.ts / index.ts).
  corsOrigins?: string[];
  // Optional AI client config for recipe import. Null/omitted → import returns 503.
  ai?: AiConfig | null;
}

const DEFAULT_CORS_ORIGINS = ['https://mase.fi', 'http://localhost:5173'];

export function createApp(db: Db, config: AppConfig = {}) {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: config.corsOrigins ?? DEFAULT_CORS_ORIGINS,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );

  // Public: the deploy health check, nginx, and uptime monitors hit this with no
  // token. Registered before the auth middleware so it stays unauthenticated.
  app.get('/api/health', (c) => c.json({ ok: true, name: 'diet-app-api' }));

  // Everything below requires a valid bearer token when one is configured.
  if (config.authToken) {
    app.use('/api/*', bearerAuth(config.authToken));
  }

  app.route('/api/ingredients', ingredientsRoutes(db));
  app.route('/api/recipes', recipesRoutes(db, { ai: config.ai ?? null }));
  app.route('/api/pantry', pantryRoutes(db));
  app.route('/api/meal-plans', mealPlansRoutes(db));
  app.route('/api/shopping-lists', shoppingListsRoutes(db));
  app.route('/api/profile', profileRoutes(db));

  return app;
}
