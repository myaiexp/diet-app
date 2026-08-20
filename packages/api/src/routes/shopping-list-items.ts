// Shopping list item writes: hand-add, edit, delete a single line

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { shoppingLists, shoppingListItems, ingredients } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { notFound, badRequest, conflict } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { buildPatch } from '../patch-builder.js';
import { itemCreateSchema, itemPatchSchema } from '../schemas/shopping-lists.js';
import { isFkViolation, isUniqueViolation } from '../pg-errors.js';
import { toBase, baseUnit, round6 } from '../units.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type ListLock =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'done' };

const DONE_LOCKED = 'Completed shopping list cannot be modified';

async function lockList(tx: Tx, listId: string): Promise<ListLock> {
  const [list] = await tx
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.id, listId))
    .for('update');
  if (!list) return { kind: 'not_found' };
  if (list.status === 'done') return { kind: 'done' };
  return { kind: 'ok' };
}

export function shoppingListItemsRoutes(db: Db): Hono {
  const app = new Hono();

  // Two-segment literals registered first (see routes/shopping-lists.ts for
  // how this router is mounted) — /items/:id can never match /:id/items or
  // vice versa since the segment counts differ, but this keeps the literal
  // paths grouped ahead of the param-first one as a matter of course.
  app.patch('/items/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const parsed = await parseJsonBody(c, itemPatchSchema, { requireNonEmpty: true });
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // quantityNeeded and netToBuy are numeric in Postgres — Drizzle wants the
    // string form. unit/ingredientId aren't columns buildPatch would ever
    // touch: itemPatchSchema.strict() already 400s an attempt to send them.
    const patch: Partial<typeof shoppingListItems.$inferInsert> = buildPatch(data, shoppingListItems, [
      'quantityNeeded',
      'netToBuy',
    ]);
    if (data.quantityNeeded !== undefined) patch.quantityNeeded = String(data.quantityNeeded);
    if (data.netToBuy !== undefined) patch.netToBuy = String(data.netToBuy);

    const result = await db.transaction(async (tx) => {
      const [item] = await tx
        .select({ listId: shoppingListItems.listId })
        .from(shoppingListItems)
        .where(eq(shoppingListItems.id, id));
      if (!item) return { kind: 'not_found' } as const;

      const lock = await lockList(tx, item.listId);
      if (lock.kind !== 'ok') return lock;

      const [row] = await tx
        .update(shoppingListItems)
        .set(patch)
        .where(eq(shoppingListItems.id, id))
        .returning();
      if (!row) return { kind: 'not_found' } as const;
      return { kind: 'ok' as const, row };
    });

    if (result.kind === 'not_found') return notFound(c);
    if (result.kind === 'done') return conflict(c, DONE_LOCKED);
    return c.json(result.row);
  });

  app.delete('/items/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const result = await db.transaction(async (tx) => {
      const [item] = await tx
        .select({ listId: shoppingListItems.listId })
        .from(shoppingListItems)
        .where(eq(shoppingListItems.id, id));
      if (!item) return { kind: 'not_found' } as const;

      const lock = await lockList(tx, item.listId);
      if (lock.kind !== 'ok') return lock;

      const deleted = await tx
        .delete(shoppingListItems)
        .where(eq(shoppingListItems.id, id))
        .returning({ id: shoppingListItems.id });
      if (deleted.length === 0) return { kind: 'not_found' } as const;
      return { kind: 'ok' } as const;
    });

    if (result.kind === 'not_found') return notFound(c);
    if (result.kind === 'done') return conflict(c, DONE_LOCKED);
    return c.body(null, 204);
  });

  app.post('/:id/items', async (c) => {
    const listId = c.req.param('id');
    if (!isUuid(listId)) return badRequest(c, 'Invalid id format');

    const parsed = await parseJsonBody(c, itemCreateSchema);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // Normalize to the dimension base before writing: the unique index is
    // (list_id, ingredient_id, unit), so an un-normalized 'kg' row would sit
    // beside a generated 'g' row for the same ingredient instead of colliding
    // with it, and the duplicate guard below would silently do nothing.
    const based = toBase(data.quantityNeeded, data.unit);
    if (!based) return badRequest(c, 'Unrecognized unit');
    const quantity = round6(based.value);
    const unit = baseUnit(based.dimension);

    try {
      const result = await db.transaction(async (tx) => {
        const lock = await lockList(tx, listId);
        if (lock.kind !== 'ok') return lock;

        const [ingredient] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, data.ingredientId));
        if (!ingredient) return { kind: 'bad_ref' } as const;

        const [row] = await tx
          .insert(shoppingListItems)
          .values({
            listId,
            ingredientId: data.ingredientId,
            quantityNeeded: String(quantity),
            // A manual row is never netted against the pantry: the user typed
            // exactly what they want to buy, and regeneration never revisits
            // manual rows (only generated ones), so a netted value here could
            // never be refreshed later — a stale number forever beats an absent
            // one only in appearance, not in usefulness.
            quantityInPantry: '0',
            netToBuy: String(quantity),
            category: ingredient.category,
            unit,
            source: 'manual',
            bought: false,
            customNote: data.customNote ?? null,
          })
          .returning();

        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'not_found') return notFound(c);
      if (result.kind === 'done') return conflict(c, DONE_LOCKED);
      if (result.kind === 'bad_ref') return badRequest(c, 'Invalid reference');
      return c.json(result.row, 201);
    } catch (err) {
      // Same (list, ingredient, unit) already has a row — collide, don't duplicate.
      if (isUniqueViolation(err)) {
        return conflict(c, 'An item for this ingredient and unit already exists');
      }
      // Race: ingredient deleted between pre-check and insert.
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }
  });

  return app;
}
