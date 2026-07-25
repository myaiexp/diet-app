// Pantry CRUD routes (list/get + create/update/delete with status)

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { pantryItems, ingredients } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { computeStatus } from '../pantry-status.js';
import { resolveExpiresDate } from '../pantry-expiry.js';
import { notFound, badRequest } from '../responses.js';
import { parseJsonBody } from '../json-body.js';
import { buildPatch } from '../patch-builder.js';
import { pantryCreateSchema, pantryPatchSchema } from '../schemas/pantry.js';
import { isFkViolation } from '../pg-errors.js';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function withStatus<T extends { expiresDate: string }>(row: T) {
  return { ...row, status: computeStatus(row.expiresDate) };
}

export function pantryRoutes(db: Db): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const { limit, offset } = getPagination(c);
    const rows = await db.select().from(pantryItems).limit(limit).offset(offset);
    return c.json(rows.map(withStatus));
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');
    const row = await db.query.pantryItems.findFirst({
      where: eq(pantryItems.id, id),
    });
    if (!row) return notFound(c);
    return c.json(withStatus(row));
  });

  app.post('/', async (c) => {
    const parsed = await parseJsonBody(c, pantryCreateSchema);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;
    const addedDate = data.addedDate ?? todayUtc();
    const opened = data.opened ?? false;

    const ingredient = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, data.ingredientId),
    });
    if (!ingredient) return badRequest(c, 'Invalid reference');

    let expiresDate = data.expiresDate;
    if (!expiresDate) {
      const resolved = resolveExpiresDate(
        ingredient.shelfLife as Record<string, number | null | undefined>,
        data.location,
        addedDate,
      );
      if (!resolved) {
        return badRequest(
          c,
          'expiresDate is required when ingredient has no shelf life for this location',
        );
      }
      expiresDate = resolved;
    }

    try {
      const [row] = await db
        .insert(pantryItems)
        .values({
          ingredientId: data.ingredientId,
          quantity: String(data.quantity),
          unit: data.unit,
          location: data.location,
          addedDate,
          expiresDate,
          opened,
        })
        .returning();

      return c.json(withStatus(row), 201);
    } catch (err) {
      // Race: ingredient deleted between pre-check and insert.
      if (isFkViolation(err)) return badRequest(c, 'Invalid reference');
      throw err;
    }
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const parsed = await parseJsonBody(c, pantryPatchSchema, { requireNonEmpty: true });
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    const existing = await db.query.pantryItems.findFirst({
      where: eq(pantryItems.id, id),
    });
    if (!existing) return notFound(c);

    // quantity is numeric in Postgres — Drizzle wants the string form.
    const patch: Partial<typeof pantryItems.$inferInsert> = {
      ...buildPatch(data, pantryItems, ['quantity']),
      updatedAt: new Date(),
    };
    if (data.quantity !== undefined) patch.quantity = String(data.quantity);

    const [row] = await db
      .update(pantryItems)
      .set(patch)
      .where(eq(pantryItems.id, id))
      .returning();

    return c.json(withStatus(row));
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const deleted = await db
      .delete(pantryItems)
      .where(eq(pantryItems.id, id))
      .returning({ id: pantryItems.id });

    if (deleted.length === 0) return notFound(c);
    return c.body(null, 204);
  });

  return app;
}
