// Mock-based route tests for PATCH and DELETE /pantry/:id.

import { describe, test, expect } from 'vitest';
import { pantryRoutes } from '../routes/pantry.js';
import { FRESH_ROW, ITEM_ID, makeWriteMock } from './pantry-test-helpers.js';

describe('pantryRoutes', () => {
  test('PATCH /:id returns 404 when missing', async () => {
    const { db } = makeWriteMock({ existingItem: null });
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5 }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  // Finding #5751: pre-check saw the row, then a concurrent DELETE emptied
  // UPDATE … RETURNING — withStatus(undefined) would TypeError into a 500.
  test('PATCH /:id returns 404 when the row is gone between read and update', async () => {
    const { db } = makeWriteMock({ updateRows: [] });
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5 }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('PATCH /:id rejects empty body', async () => {
    const { db } = makeWriteMock({});
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('PATCH /:id does not recompute expiresDate when only location changes', async () => {
    const { db, updates } = makeWriteMock({
      updateRow: { ...FRESH_ROW, location: 'freezer' },
    });
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'freezer' }),
    });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ location: 'freezer' });
    expect(updates[0]).not.toHaveProperty('expiresDate');
    // PATCH can't change ingredientId, so the ingredient read for the
    // pre-check is still the right one to answer with — no second query.
    expect((await res.json()).ingredient.name).toBe('Salmon fillet');
  });

  // Finding #7551: quantity is numeric in Postgres — Drizzle wants the string
  // form. The 404 paths send {quantity:5} but return before the write, so a
  // dropped String() special case (or a silent expiresDate recompute) would
  // not fail the suite.
  test('PATCH /:id writes quantity as a string plus opened and expiresDate, keeping the pre-check ingredient', async () => {
    const { db, updates } = makeWriteMock({});
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quantity: 5,
        opened: true,
        expiresDate: '2099-06-01',
      }),
    });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      quantity: '5',
      opened: true,
      expiresDate: '2099-06-01',
    });
    expect((updates[0] as { quantity: unknown }).quantity).toBe('5');
    const body = await res.json();
    expect(body.ingredient.name).toBe('Salmon fillet');
    expect(body.quantity).toBe('5');
    expect(body.opened).toBe(true);
    expect(body.expiresDate).toBe('2099-06-01');
  });

  test('DELETE /:id returns 204 when deleted', async () => {
    const { db } = makeWriteMock({ deleteRows: [{ id: ITEM_ID }] });
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  test('DELETE /:id returns 404 when missing', async () => {
    const { db } = makeWriteMock({ deleteRows: [] });
    const res = await pantryRoutes(db).request(`/${ITEM_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('PATCH/DELETE reject non-uuid with 400 before DB', async () => {
    const app = pantryRoutes({} as any);
    const patch = await app.request('/not-a-uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 1 }),
    });
    expect(patch.status).toBe(400);
    expect(await patch.json()).toEqual({ error: 'Invalid id format' });

    const del = await app.request('/not-a-uuid', { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect(await del.json()).toEqual({ error: 'Invalid id format' });
  });
});
