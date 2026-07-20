// Pantry CRUD routes (list/get + create/update/delete with status)

import { Hono } from 'hono';
import type { Db } from '@diet-app/db';
import { pantryItems, ingredients } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isUuid } from '../validation.js';
import { getPagination } from '../pagination.js';
import { computeStatus } from '../pantry-status.js';
import { resolveExpiresDate } from '../pantry-expiry.js';
import { notFound, badRequest } from '../responses.js';
import { readJsonBody } from '../json-body.js';
import { pantryCreateSchema, pantryPatchSchema } from '../schemas/pantry.js';

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
    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = pantryCreateSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
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
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return badRequest(c, 'Invalid id format');

    const body = await readJsonBody(c);
    if (!body.ok) return body.response;

    const parsed = pantryPatchSchema.safeParse(body.data);
    if (!parsed.success) {
      return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
    }
    const data = parsed.data;
    if (Object.keys(data).length === 0) {
      return badRequest(c, 'Validation failed', { formErrors: ['Empty patch body'] });
    }

    const existing = await db.query.pantryItems.findFirst({
      where: eq(pantryItems.id, id),
    });
    if (!existing) return notFound(c);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.quantity !== undefined) patch.quantity = String(data.quantity);
    if (data.unit !== undefined) patch.unit = data.unit;
    if (data.location !== undefined) patch.location = data.location;
    if (data.addedDate !== undefined) patch.addedDate = data.addedDate;
    if (data.expiresDate !== undefined) patch.expiresDate = data.expiresDate;
    if (data.opened !== undefined) patch.opened = data.opened;

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
