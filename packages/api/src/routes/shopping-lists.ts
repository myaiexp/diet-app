// Shopping list reads + status/delete writes; mounts generate/items/complete

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { shoppingLists, shoppingListItems } from '@diet-app/db';
import { asc, desc, eq, lte } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { buildPatch } from '../patch-builder.js';
import { listPatchSchema } from '../schemas/shopping-lists.js';
import { sortListItems } from '../shopping-sort.js';
import { shoppingListGenerateRoutes } from './shopping-list-generate.js';
import { shoppingListItemsRoutes } from './shopping-list-items.js';
import { shoppingListCompleteRoutes } from './shopping-list-complete.js';

// The list's items with their ingredient joined — sortListItems reads `name`
// and `isPantryStaple` off it live rather than from a snapshot on the item row.
const WITH_ITEMS = { items: { with: { ingredient: true } } } as const;

type ListWithItems = { items: Parameters<typeof sortListItems>[0] };

function sorted<T extends ListWithItems>(row: T): T {
  return { ...row, items: sortListItems(row.items) };
}

type PatchResult =
  | { kind: 'ok'; row: typeof shoppingLists.$inferSelect }
  | { kind: 'not_found' }
  | { kind: 'complete_owned' }
  | { kind: 'done_immutable' };

export function shoppingListsRoutes(db: Db): Hono {
  const app = new Hono();

  // Single-segment literals before /:id. POST /generate is the only one that
  // could actually collide today, but keeping literals first is the rule.
  app.route('/', shoppingListGenerateRoutes(db));

  app.get('/current', async (c) => {
    // "Current" = the list whose week has most recently started (week_starting on
    // or before today), ordered newest-first — not the most recently *created*
    // row. Ordering by createdAt would let a list drafted in advance for a future
    // week shadow the one actually covering the current week. The <= today filter
    // also excludes future-week drafts entirely.
    const today = new Date().toISOString().slice(0, 10);
    const row = await db.query.shoppingLists.findFirst({
      where: lte(shoppingLists.weekStarting, today),
      orderBy: desc(shoppingLists.weekStarting),
      with: WITH_ITEMS,
    });
    if (!row) return notFound(c);
    return c.json(sorted(row));
  });

  app.get('/', async (c) => {
    const { limit, offset } = getPagination(c);
    // Newest week first, tie-broken on id: one row per week and growing, so
    // paging is the only way to read it and a non-total order can repeat a row
    // across two pages. No relations here, so the core builder is correct.
    const rows = await db
      .select()
      .from(shoppingLists)
      .orderBy(desc(shoppingLists.weekStarting), asc(shoppingLists.id))
      .limit(limit)
      .offset(offset);
    return c.json(rows);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');
    const row = await db.query.shoppingLists.findFirst({
      where: eq(shoppingLists.id, id),
      with: WITH_ITEMS,
    });
    if (!row) return notFound(c);
    return c.json(sorted(row));
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const parsed = await parseJsonBody(c, listPatchSchema, { requireNonEmpty: true });
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // FOR UPDATE so a concurrent /complete can't land between the guard and the
    // write and have its 'done' silently overwritten by a plain status flip.
    const result: PatchResult = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(shoppingLists)
        .where(eq(shoppingLists.id, id))
        .for('update');
      if (!existing) return { kind: 'not_found' };

      // done is terminal and reachable only through POST /:id/complete, which
      // has pantry side effects a plain status flip would skip — the same
      // ownership cooked has on meal plan entries. Re-sending an unchanged
      // 'done' is a no-op and passes; only real transitions are blocked.
      if (data.status !== undefined) {
        if (data.status === 'done' && existing.status !== 'done') {
          return { kind: 'complete_owned' };
        }
        if (existing.status === 'done' && data.status !== 'done') {
          return { kind: 'done_immutable' };
        }
      }

      const [row] = await tx
        .update(shoppingLists)
        .set({ ...buildPatch(data, shoppingLists), updatedAt: new Date() })
        .where(eq(shoppingLists.id, id))
        .returning();
      return { kind: 'ok', row };
    });

    if (result.kind === 'not_found') return notFound(c);
    if (result.kind === 'complete_owned') {
      return conflict(c, 'Use POST /shopping-lists/:id/complete to mark a list done');
    }
    if (result.kind === 'done_immutable') {
      return conflict(c, 'Completed shopping list status is immutable');
    }
    return c.json(result.row);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(shoppingLists)
        .where(eq(shoppingLists.id, id))
        .for('update');
      if (!existing) return 'not_found' as const;
      // A completed list is the only record of a purchase — not erasable by
      // accident, consistent with cooked being terminal on a meal plan entry.
      if (existing.status === 'done') return 'done' as const;

      // Items first: shopping_list_items.list_id has no ON DELETE CASCADE.
      await tx.delete(shoppingListItems).where(eq(shoppingListItems.listId, id));
      await tx.delete(shoppingLists).where(eq(shoppingLists.id, id));
      return 'ok' as const;
    });

    if (result === 'not_found') return notFound(c);
    if (result === 'done') return conflict(c, 'Completed shopping list cannot be deleted');
    return c.body(null, 204);
  });

  // Two-segment routes — no collision with the one-segment /:id above.
  app.route('/', shoppingListItemsRoutes(db));
  app.route('/', shoppingListCompleteRoutes(db));

  return app;
}
