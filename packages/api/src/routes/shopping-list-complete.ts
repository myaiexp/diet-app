// POST /:id/complete — mark a shopping list done, file bought items to pantry

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { shoppingLists, shoppingListItems, pantryItems, ingredients } from '@diet-app/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { completeSchema } from '../schemas/shopping-lists.js';
import { locationForCategory } from '../pantry-location.js';
import { resolveExpiresDate } from '../pantry-expiry.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type SkippedItem = { itemId: string; reason: 'no_shelf_life' };

type CompleteOk = {
  kind: 'ok';
  list: typeof shoppingLists.$inferSelect;
  added: (typeof pantryItems.$inferSelect)[];
  skipped: SkippedItem[];
};
type CompleteErr = { kind: 'not_found' } | { kind: 'already_done' };

// Files one pantry row per surviving item; items with no shelf-life entry for
// their resolved location are reported in `skipped` rather than aborting the
// whole completion — a partial file is strictly better than filing nothing
// because one ingredient's shelf life JSON is incomplete.
async function fileItems(
  tx: Tx,
  items: (typeof shoppingListItems.$inferSelect)[],
  ingredientById: Map<string, typeof ingredients.$inferSelect>,
  overrides: Map<string, string>,
  today: string,
): Promise<{ added: (typeof pantryItems.$inferSelect)[]; skipped: SkippedItem[] }> {
  const added: (typeof pantryItems.$inferSelect)[] = [];
  const skipped: SkippedItem[] = [];

  for (const item of items) {
    const ingredient = ingredientById.get(item.ingredientId);
    const location = overrides.get(item.id) ?? locationForCategory(item.category);
    // shelfLife is jsonb (untyped at the column level, same cast pantry.ts uses).
    const shelfLife = ingredient?.shelfLife as Record<string, number | null | undefined>;
    const expiresDate = resolveExpiresDate(shelfLife, location, today);
    if (expiresDate === null) {
      skipped.push({ itemId: item.id, reason: 'no_shelf_life' });
      continue;
    }

    const [row] = await tx
      .insert(pantryItems)
      .values({
        ingredientId: item.ingredientId,
        quantity: String(item.netToBuy),
        unit: item.unit,
        location,
        addedDate: today,
        expiresDate,
        opened: false,
      })
      .returning();
    added.push(row);
  }

  return { added, skipped };
}

export function shoppingListCompleteRoutes(db: Db): Hono {
  const app = new Hono();

  app.post('/:id/complete', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    // `overrides` is optional, but c.req.json() throws SyntaxError on a
    // genuinely empty request body (no bytes to parse) — parseJsonBody turns
    // that into 'Invalid JSON body'. We deliberately don't special-case a
    // bodyless request into "no overrides": callers must send at least `{}`,
    // matching every write route here but POST /cook, which was body-less
    // before it grew an override and so opts into `allowEmptyBody`.
    const parsed = await parseJsonBody(c, completeSchema);
    if (!parsed.ok) return parsed.response;
    const overrides = new Map(
      (parsed.data.overrides ?? []).map((o) => [o.itemId, o.location] as const),
    );

    const today = new Date().toISOString().slice(0, 10);

    const result: CompleteOk | CompleteErr = await db.transaction(async (tx) => {
      // 1. Lock the list — a concurrent complete must not double-file.
      const [list] = await tx
        .select()
        .from(shoppingLists)
        .where(eq(shoppingLists.id, id))
        .for('update');
      if (!list) return { kind: 'not_found' };
      if (list.status === 'done') return { kind: 'already_done' };

      // 2. Lock every item for the list so a concurrent PATCH can't change
      // bought/netToBuy after this snapshot is what we file into pantry.
      // bought/net-to-buy filtering happens here in application code rather
      // than in the WHERE clause — net_to_buy is numeric (returned as a
      // string), and comparing it against 0 belongs next to the rest of the
      // per-item logic below.
      const items = await tx
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, id))
        .orderBy(asc(shoppingListItems.id))
        .for('update');
      const toFile = items.filter((i) => i.bought && Number(i.netToBuy) > 0);

      const ingredientIds = [...new Set(toFile.map((i) => i.ingredientId))];
      const ingredientRows = ingredientIds.length
        ? await tx.select().from(ingredients).where(inArray(ingredients.id, ingredientIds))
        : [];
      const ingredientById = new Map(ingredientRows.map((ing) => [ing.id, ing]));

      // 3-4. Resolve location + expiry per item, insert survivors.
      const { added, skipped } = await fileItems(tx, toFile, ingredientById, overrides, today);

      // 5. Mark the list done — terminal, same as cook on a meal plan entry.
      const [updated] = await tx
        .update(shoppingLists)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(shoppingLists.id, id))
        .returning();

      return { kind: 'ok', list: updated, added, skipped };
    });

    if (result.kind === 'not_found') return notFound(c);
    if (result.kind === 'already_done') return conflict(c, 'Shopping list already completed');

    return c.json({ list: result.list, added: result.added, skipped: result.skipped });
  });

  return app;
}
