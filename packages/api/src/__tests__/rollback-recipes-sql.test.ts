// Real-Postgres proof that every multi-write recipe route rolls back as a unit
//
// db-mock.ts runs a transaction callback against its recording builders and
// never rolls back, so the mock suites pass the same whether a route wraps its
// writes in db.transaction or issues them bare. Each case here fails a route
// after it has already written, then asserts Postgres kept none of it — so
// each one fails if that route's transaction wrapper is removed.
import { randomUUID } from 'node:crypto';
import { describe, test, expect } from 'vitest';
import { recipes, recipeIngredients } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';
import { silenceInjectedFaults, withWriteFault } from './fault-db.js';
import {
  dropRecipes,
  ingredientNamed,
  insertRecipe,
  json,
  recipeIdsTitled,
} from './rollback-fixtures.js';

const { db, hasDb } = useRealDb();
silenceInjectedFaults();

const linesOf = (recipeId: string) =>
  db!.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));

describe.skipIf(!hasDb)('recipe writes roll back as a unit', () => {
  test('POST: an unknown ingredient leaves no orphan recipe row', async () => {
    const title = `Rollback POST ${randomUUID()}`;
    try {
      const res = await createApp(db!).request(
        '/api/recipes',
        json('POST', {
          title,
          servings: 1,
          ingredients: [{ ingredientId: randomUUID(), quantity: 1, unit: 'g' }],
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid reference' });
      // The recipes insert ran before the lines insert tripped the FK; only the
      // transaction takes it back out.
      expect(await recipeIdsTitled(db!, title)).toEqual([]);
    } finally {
      await dropRecipes(db!, await recipeIdsTitled(db!, title));
    }
  });

  test('POST /:id/fork: a failed line copy leaves no half-made fork', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    const source = await insertRecipe(db!, `Rollback fork ${randomUUID()}`, [
      { ingredientId: carrot.id, quantity: 100, unit: 'g' },
    ]);
    try {
      const fault = withWriteFault(db!, 'insert', recipeIngredients);
      const res = await createApp(fault.db).request(`/api/recipes/${source.id}/fork`, json('POST'));
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual(['insert:recipes', 'insert:recipe_ingredients']);

      const forks = await db!
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.parentRecipeId, source.id));
      expect(forks).toEqual([]);
    } finally {
      await dropRecipes(db!, [source.id]);
    }
  });

  test('PATCH: an unknown ingredient keeps the old title and lines', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    const title = `Rollback PATCH ${randomUUID()}`;
    const recipe = await insertRecipe(db!, title, [
      { ingredientId: carrot.id, quantity: 100, unit: 'g' },
    ]);
    try {
      // Rename, wipe the lines, then fail inserting the replacements: the
      // first two writes both land before the FK trips.
      const res = await createApp(db!).request(
        `/api/recipes/${recipe.id}`,
        json('PATCH', {
          title: `${title} renamed`,
          ingredients: [{ ingredientId: randomUUID(), quantity: 1, unit: 'g' }],
        }),
      );
      expect(res.status).toBe(400);

      const [row] = await db!.select().from(recipes).where(eq(recipes.id, recipe.id));
      expect(row!.title).toBe(title);
      const lines = await linesOf(recipe.id);
      expect(lines.map((l) => [l.ingredientId, l.quantity, l.unit])).toEqual([
        [carrot.id, '100', 'g'],
      ]);
    } finally {
      await dropRecipes(db!, [recipe.id]);
    }
  });

  test('DELETE: a failed recipe delete keeps its ingredient lines', async () => {
    const carrot = await ingredientNamed(db!, 'carrot');
    const recipe = await insertRecipe(db!, `Rollback DELETE ${randomUUID()}`, [
      { ingredientId: carrot.id, quantity: 100, unit: 'g' },
    ]);
    try {
      const fault = withWriteFault(db!, 'delete', recipes);
      const res = await createApp(fault.db).request(`/api/recipes/${recipe.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(500);
      expect(fault.issued).toEqual(['delete:recipe_ingredients', 'delete:recipes']);

      expect(await linesOf(recipe.id)).toHaveLength(1);
      expect(await recipeIdsTitled(db!, recipe.title)).toEqual([recipe.id]);
    } finally {
      await dropRecipes(db!, [recipe.id]);
    }
  });
});
