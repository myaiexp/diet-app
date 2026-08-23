// Hono app factory: body cap, CORS, CSRF, auth, route mount
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Db } from '@diet-app/db';
import { bearerAuth } from './auth.js';
import { csrfGuard } from './csrf.js';
import { ingredientsRoutes } from './routes/ingredients.js';
import { recipesRoutes } from './routes/recipes.js';
import { pantryRoutes } from './routes/pantry.js';
import { mealPlansRoutes } from './routes/meal-plans.js';
import { shoppingListsRoutes } from './routes/shopping-lists.js';
import { profileRoutes } from './routes/profile.js';
import type { AiConfig } from './config.js';
import { payloadTooLarge } from './responses.js';

export interface AppConfig {
  // When set, every /api/* route except /api/health requires `Bearer <authToken>`.
  // Omitted in unit tests so route logic can be exercised without a token.
  authToken?: string;
  // Allowed CORS origins. Empty when omitted: the live app is same-origin, so
  // the browser path needs none. Production passes CORS_ORIGINS via index.ts.
  corsOrigins?: string[];
  // Optional AI client config for recipe import. Null/omitted → import returns 503.
  ai?: AiConfig | null;
}

// Wire-level body cap, below nginx's 2M so loopback (and a mis-proxy) cannot
// buffer more than the edge already allows. 1 MiB still fits a max-size recipe
// write (80×4k steps + 80×4k notes ≈ 640 KiB plus JSON).
export const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(db: Db, config: AppConfig = {}) {
  const app = new Hono();

  // Before CORS/auth: Hono buffers the body in-process, and a loopback client
  // bypasses nginx's 2M. Reject by Content-Length (or streamed byte count)
  // rather than letting c.req.json() allocate first.
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => payloadTooLarge(c),
    }),
  );

  app.use(
    '*',
    cors({
      origin: config.corsOrigins ?? [],
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );

  // Public: the deploy health check, nginx, and uptime monitors hit this with no
  // token. Registered before the auth middleware so it stays unauthenticated.
  app.get('/api/health', (c) => c.json({ ok: true, name: 'diet-app-api' }));

  // Before bearerAuth so a sibling CSRF is 403/415 even with a valid token.
  // GET/HEAD/OPTIONS skip it; health is registered above and never reaches here.
  app.use('/api/*', csrfGuard(config.corsOrigins ?? []));

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
