// POST /generate — derive a week's shopping list from the meal plan

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import {
  shoppingLists,
  shoppingListItems,
  mealPlanEntries,
  recipes,
  recipeIngredients,
  pantryItems,
  ingredients,
} from '@diet-app/db';
import { and, asc, eq, gte, inArray, lte, not, or, sql } from 'drizzle-orm';
import { conflict } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { generateSchema } from '../schemas/shopping-lists.js';
import { getISOWeekBounds } from '../date.js';
import { sortListItems } from '../shopping-sort.js';
import { isUniqueViolation } from '../pg-errors.js';
import {
  aggregateShoppingList,
  type AggregateRecipeLine,
  type PantrySupplyRow,
  type SkippedLine,
} from '../shopping-aggregate.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ListRow = typeof shoppingLists.$inferSelect;

type GenerateResult =
  | { kind: 'not_draft' }
  | { kind: 'ok'; list: ListRow; skipped: SkippedLine[] };

// recipe_ingredients rows grouped by recipeId, exactly the shape
// aggregateShoppingList wants — pulled out so runGenerate stays readable.
function groupLines(rows: (typeof recipeIngredients.$inferSelect)[]): Map<string, AggregateRecipeLine[]> {
  const byRecipe = new Map<string, AggregateRecipeLine[]>();
  for (const row of rows) {
    const line: AggregateRecipeLine = {
      ingredientId: row.ingredientId,
      quantity: Number(row.quantity),
      unit: row.unit,
      optional: row.optional ?? false,
    };
    const existing = byRecipe.get(row.recipeId);
    if (existing) existing.push(line);
    else byRecipe.set(row.recipeId, [line]);
  }
  return byRecipe;
}

interface GenerateOptions {
  monday: string;
  sunday: string;
  today: string;
  includeOptional: boolean;
}

async function runGenerate(tx: Tx, opts: GenerateOptions): Promise<GenerateResult> {
  const { monday, sunday, today, includeOptional } = opts;
  // Lock first: two concurrent generates for the same week must not both see
  // "missing" and both try to insert (the unique index catches that race, but
  // locking an existing row here also serializes two regenerates of one week).
  const [existing] = await tx
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.weekStarting, monday))
    .for('update');
  if (existing && existing.status !== 'draft') return { kind: 'not_draft' };

  const list =
    existing ??
    (await tx.insert(shoppingLists).values({ weekStarting: monday }).returning())[0]!;

  const entries = await tx
    .select()
    .from(mealPlanEntries)
    .where(and(gte(mealPlanEntries.date, monday), lte(mealPlanEntries.date, sunday)));

  // substituteRecipeId ?? recipeId, deduped — mirrors loadCookPlan so a
  // substituted entry contributes exactly one recipe's lines, not both.
  const recipeIds = [
    ...new Set(
      entries
        .map((e) => e.substituteRecipeId ?? e.recipeId)
        .filter((id): id is string => id != null),
    ),
  ];
  const recipeRows = recipeIds.length
    ? await tx.select().from(recipes).where(inArray(recipes.id, recipeIds))
    : [];
  const lineRows = recipeIds.length
    ? await tx.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds))
    : [];

  const ingredientIds = [...new Set(lineRows.map((l) => l.ingredientId))];
  const pantryRows = ingredientIds.length
    ? await tx.select().from(pantryItems).where(inArray(pantryItems.ingredientId, ingredientIds))
    : [];
  const ingredientRows = ingredientIds.length
    ? await tx.select().from(ingredients).where(inArray(ingredients.id, ingredientIds))
    : [];

  const { items, skipped } = aggregateShoppingList({
    entries: entries.map((e) => ({
      id: e.id,
      recipeId: e.recipeId,
      substituteRecipeId: e.substituteRecipeId,
      servings: Number(e.servings),
      status: e.status,
      date: e.date,
    })),
    recipesById: new Map(recipeRows.map((r) => [r.id, { servings: r.servings }])),
    linesByRecipe: groupLines(lineRows),
    pantryRows: pantryRows.map(
      (p): PantrySupplyRow => ({
        ingredientId: p.ingredientId,
        quantity: Number(p.quantity),
        unit: p.unit,
        expiresDate: p.expiresDate,
      }),
    ),
    ingredientsById: new Map(ingredientRows.map((i) => [i.id, { category: i.category }])),
    today,
    includeOptional,
  });

  if (items.length > 0) {
    await tx
      .insert(shoppingListItems)
      .values(
        items.map((item) => ({
          listId: list.id,
          ingredientId: item.ingredientId,
          unit: item.unit,
          quantityNeeded: String(item.quantityNeeded),
          quantityInPantry: String(item.quantityInPantry),
          netToBuy: String(item.netToBuy),
          category: item.category,
        })),
      )
      .onConflictDoUpdate({
        target: [shoppingListItems.listId, shoppingListItems.ingredientId, shoppingListItems.unit],
        // bought / customNote / source are user-owned: regeneration must refresh
        // the plan's numbers without resurrecting or relabeling what the user
        // already decided about a row. `excluded.*` picks up each conflicting
        // row's own proposed values out of the multi-row VALUES list above.
        // setWhere keeps the rewrite generation-owned: a colliding manual row
        // (same list/ingredient/unit) is a no-op, not an overwrite — the prune
        // below is already source-scoped, and without this the user's amount
        // plus a never-refreshed netted quantityInPantry would stick forever.
        set: {
          quantityNeeded: sql`excluded.quantity_needed`,
          quantityInPantry: sql`excluded.quantity_in_pantry`,
          netToBuy: sql`excluded.net_to_buy`,
          category: sql`excluded.category`,
        },
        setWhere: eq(shoppingListItems.source, 'generated'),
      });
  }

  // Prune only what generation itself owns and can safely take back: a manual
  // row (source check) was never the plan's to begin with, and a bought row
  // (bought check) already left the "to buy" phase — /complete still needs it
  // for the pantry hand-off even if the plan moved on. Only when items exist do
  // we know which (ingredient, unit) pairs to spare from the NOT(OR(...)).
  const keepConditions = items.map((item) =>
    and(eq(shoppingListItems.ingredientId, item.ingredientId), eq(shoppingListItems.unit, item.unit)),
  );
  const pruneConditions = [
    eq(shoppingListItems.listId, list.id),
    eq(shoppingListItems.source, 'generated'),
    eq(shoppingListItems.bought, false),
  ];
  if (keepConditions.length > 0) pruneConditions.push(not(or(...keepConditions)!));
  await tx.delete(shoppingListItems).where(and(...pruneConditions));

  return { kind: 'ok', list, skipped };
}

export function shoppingListGenerateRoutes(db: Db): Hono {
  const app = new Hono();

  app.post('/generate', async (c) => {
    const parsed = await parseJsonBody(c, generateSchema);
    if (!parsed.ok) return parsed.response;

    const { monday, sunday } = getISOWeekBounds(parsed.data.weekStarting);
    const today = new Date().toISOString().slice(0, 10);

    let result: GenerateResult;
    try {
      result = await db.transaction((tx) =>
        runGenerate(tx, {
          monday,
          sunday,
          today,
          includeOptional: parsed.data.includeOptional ?? false,
        }),
      );
    } catch (err) {
      // The week_starting unique index turns a concurrent generate for the same
      // week into this 23505 instead of two draft lists racing each other.
      if (isUniqueViolation(err)) {
        return conflict(c, 'Shopping list for this week already exists');
      }
      throw err;
    }

    if (result.kind === 'not_draft') {
      return conflict(c, 'Shopping list for this week is not a draft');
    }

    // Relational read for the ingredient join sortListItems needs (name,
    // isPantryStaple) — same eager-load case GET /:id and /current use, and run
    // after the transaction commits so it sees the upsert/delete it just made.
    const rows = await db.query.shoppingListItems.findMany({
      where: eq(shoppingListItems.listId, result.list.id),
      with: { ingredient: true },
      orderBy: asc(shoppingListItems.id),
    });

    return c.json({
      list: result.list,
      items: sortListItems(rows),
      skipped: result.skipped,
    });
  });

  return app;
}
