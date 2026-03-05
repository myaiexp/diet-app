import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from '@diet-app/db';
import { ingredientsRoutes } from './routes/ingredients.js';
import { recipesRoutes } from './routes/recipes.js';
import { pantryRoutes } from './routes/pantry.js';
import { mealPlansRoutes } from './routes/meal-plans.js';
import { shoppingListsRoutes } from './routes/shopping-lists.js';
import { profileRoutes } from './routes/profile.js';

export function createApp(db: Db) {
  const app = new Hono();

  app.use('*', cors({ origin: '*' }));

  app.get('/api/health', (c) => c.json({ ok: true, name: 'diet-app-api' }));

  app.route('/api/ingredients', ingredientsRoutes(db));
  app.route('/api/recipes', recipesRoutes(db));
  app.route('/api/pantry', pantryRoutes(db));
  app.route('/api/meal-plans', mealPlansRoutes(db));
  app.route('/api/shopping-lists', shoppingListsRoutes(db));
  app.route('/api/profile', profileRoutes(db));

  return app;
}
