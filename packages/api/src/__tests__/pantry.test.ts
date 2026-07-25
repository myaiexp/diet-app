// Mock-based route tests for pantryRoutes (computeStatus has its own suite in
// pantry-status.test.ts).

import { describe, test, expect, vi } from 'vitest';
import { asc } from 'drizzle-orm';
import { pantryItems } from '@diet-app/db';
import { pantryRoutes } from '../routes/pantry.js';
import { makeDbMock, makeSelectMock, mergedRow, pgError } from './db-mock.js';
import { DEFAULT_LIMIT } from '../pagination.js';

// Mock-based route tests for pantryRoutes — deterministic, Postgres-free.
// The GET handlers use the real `new Date()`, so far-future / far-past expiry
// dates keep computeStatus deterministic on any run date and in any timezone.
const FRESH_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  ingredientId: '22222222-2222-4222-8222-222222222222',
  quantity: '2',
  unit: 'pcs',
  location: 'fridge',
  addedDate: '2026-07-01',
  expiresDate: '2099-12-31',
  opened: false,
};
const EXPIRED_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  expiresDate: '2000-01-01',
};

const INGREDIENT_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '11111111-1111-4111-8111-111111111111';

function makeWriteMock(opts: {
  ingredient?: { id: string; shelfLife: Record<string, number | null> } | null;
  /** Existing pantry row for PATCH; use null for 404. Default: FRESH_ROW. */
  existingItem?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  deleteRows?: unknown[];
  /** Driver-shaped error thrown at the handler's write (FK races). */
  throwOnWrite?: unknown;
}) {
  return makeDbMock({
    throwOnWrite: () => opts.throwOnWrite,
    insertRows: () => [opts.insertRow ?? FRESH_ROW],
    updateRows: opts.updateRow ? () => [opts.updateRow] : mergedRow(FRESH_ROW),
    deleteRows: () => opts.deleteRows ?? [{ id: ITEM_ID }],
    query: {
      ingredients: {
        findFirst: vi.fn(async () =>
          opts.ingredient === undefined
            ? { id: INGREDIENT_ID, shelfLife: { fridge_days: 7 } }
            : opts.ingredient,
        ),
      },
      pantryItems: {
        findFirst: vi.fn(async () =>
          opts.existingItem === undefined ? FRESH_ROW : opts.existingItem,
        ),
      },
    },
  });
}

describe('pantryRoutes', () => {
  test('GET / maps each row to a computed status field', async () => {
    const { db } = makeSelectMock([FRESH_ROW, EXPIRED_ROW]);
    const app = pantryRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].status).toBe('fresh');
    expect(body[1].status).toBe('expired');
  });

  test('GET / applies default pagination', async () => {
    const { db, calls } = makeSelectMock([FRESH_ROW]);
    await pantryRoutes(db).request('/');
    expect(calls.limit).toBe(DEFAULT_LIMIT);
    expect(calls.offset).toBe(0);
  });

  // Finding #5450: PATCH /pantry/:id rewrites rows in place, so paging this
  // list without a total order can hand the client the same item twice and
  // never show another. Spoilage-first ordering also matches the app's framing.
  test('GET / orders by expiry with an id tie-break before paging', async () => {
    const { db, calls } = makeSelectMock([FRESH_ROW]);
    await pantryRoutes(db).request('/');
    expect(calls.orderBy).toEqual([asc(pantryItems.expiresDate), asc(pantryItems.id)]);
  });

  test('GET /:id rejects a malformed id with 400 before touching the DB', async () => {
    const app = pantryRoutes({} as any);
    const res = await app.request('/not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  test('GET /:id returns 200 with a computed status field when found', async () => {
    const mockDb = { query: { pantryItems: { findFirst: async () => FRESH_ROW } } } as any;
    const app = pantryRoutes(mockDb);
    const res = await app.request(`/${ITEM_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(FRESH_ROW.id);
    expect(body.status).toBe('fresh');
  });

  test('GET /:id returns 404 with error body when missing', async () => {
    const mockDb = { query: { pantryItems: { findFirst: async () => undefined } } } as any;
    const app = pantryRoutes(mockDb);
    const res = await app.request('/22222222-2222-4222-8222-222222222222');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('POST / creates item and returns status field', async () => {
    const { db, inserts } = makeWriteMock({
      insertRow: { ...FRESH_ROW, quantity: '3', expiresDate: '2099-12-31' },
    });
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 3,
        unit: 'pcs',
        location: 'fridge',
        expiresDate: '2099-12-31',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.quantity).toBe('3');
    expect(inserts[0]).toMatchObject({
      ingredientId: INGREDIENT_ID,
      quantity: '3',
      unit: 'pcs',
      location: 'fridge',
      expiresDate: '2099-12-31',
      opened: false,
    });
  });

  test('POST / rejects invalid location with 400 Validation failed', async () => {
    const { db } = makeWriteMock({});
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 1,
        unit: 'g',
        location: 'garage',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  test('POST / without expiresDate when shelf life missing returns 400', async () => {
    const { db } = makeWriteMock({
      ingredient: { id: INGREDIENT_ID, shelfLife: {} },
    });
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 1,
        unit: 'g',
        location: 'counter',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/expiresDate/i);
  });

  test('POST / invalid JSON returns 400 Invalid JSON body', async () => {
    const { db } = makeWriteMock({});
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  test('POST / missing ingredient returns 400 Invalid reference', async () => {
    const { db } = makeWriteMock({ ingredient: null });
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 1,
        unit: 'g',
        location: 'fridge',
        expiresDate: '2099-01-01',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
  });

  test('POST / maps an FK violation (23503) to the same 400 as the pre-check', async () => {
    // The ingredient was deleted between the pre-check and the insert — the
    // race has to be indistinguishable from the pre-check's own rejection.
    const { db, inserts } = makeWriteMock({ throwOnWrite: pgError('23503') });
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 1,
        unit: 'g',
        location: 'fridge',
        expiresDate: '2099-01-01',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
    expect(inserts).toHaveLength(1); // attempted, then mapped — not skipped
  });

  test('POST / lets a non-FK database error escape as a 500', async () => {
    const { db } = makeWriteMock({ throwOnWrite: pgError('23514') });
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 1,
        unit: 'g',
        location: 'fridge',
        expiresDate: '2099-01-01',
      }),
    });
    expect(res.status).toBe(500);
  });

  test('POST / resolves expiresDate from shelf life when omitted', async () => {
    const { db, inserts } = makeWriteMock({
      ingredient: { id: INGREDIENT_ID, shelfLife: { fridge_days: 5 } },
      insertRow: { ...FRESH_ROW, expiresDate: '2026-07-15' },
    });
    const res = await pantryRoutes(db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: INGREDIENT_ID,
        quantity: 1,
        unit: 'g',
        location: 'fridge',
        addedDate: '2026-07-10',
      }),
    });
    expect(res.status).toBe(201);
    expect(inserts[0]).toMatchObject({ expiresDate: '2026-07-15', addedDate: '2026-07-10' });
  });

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
