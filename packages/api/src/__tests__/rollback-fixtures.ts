// Direct-insert fixtures and cleanup for the real-Postgres rollback suites
import {
  ingredients,
  mealPlanEntries,
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
  type Db,
} from '@diet-app/db';
import { eq, inArray, or } from 'drizzle-orm';

export const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export async function ingredientNamed(db: Db, name: string) {
  const [row] = await db.select().from(ingredients).where(eq(ingredients.name, name));
  if (!row) throw new Error(`seed has no ingredient "${name}" — run setup:test-db`);
  return row;
}

interface Line {
  ingredientId: string;
  quantity: number;
  unit: string;
}

export async function insertRecipe(db: Db, title: string, lines: Line[], servings = 1) {
  const [recipe] = await db
    .insert(recipes)
    .values({ title, sourceType: 'manual', servings })
    .returning();
  if (lines.length > 0) {
    await db.insert(recipeIngredients).values(
      lines.map((l) => ({ recipeId: recipe!.id, ...l, quantity: String(l.quantity) })),
    );
  }
  return recipe!;
}

export async function recipeIdsTitled(db: Db, title: string): Promise<string[]> {
  const rows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.title, title));
  return rows.map((r) => r.id);
}

/**
 * Remove recipes along with everything that pins them: forks (recursively),
 * meal plan entries naming them, and their ingredient lines. Direct deletes,
 * because DELETE /api/recipes/:id refuses exactly the recipes a failed test
 * is most likely to leave behind.
 */
export async function dropRecipes(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const forks = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(inArray(recipes.parentRecipeId, ids));
  await dropRecipes(db, forks.map((f) => f.id));
  await db
    .delete(mealPlanEntries)
    .where(or(inArray(mealPlanEntries.recipeId, ids), inArray(mealPlanEntries.substituteRecipeId, ids)));
  await db.delete(recipeIngredients).where(inArray(recipeIngredients.recipeId, ids));
  await db.delete(recipes).where(inArray(recipes.id, ids));
}

/** Items first: shopping_list_items.list_id has no ON DELETE CASCADE. */
export async function dropListsForWeek(db: Db, monday: string): Promise<void> {
  const lists = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(eq(shoppingLists.weekStarting, monday));
  const ids = lists.map((l) => l.id);
  if (ids.length === 0) return;
  await db.delete(shoppingListItems).where(inArray(shoppingListItems.listId, ids));
  await db.delete(shoppingLists).where(inArray(shoppingLists.id, ids));
}
