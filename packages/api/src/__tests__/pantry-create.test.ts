// POST /pantry: create, validation, shelf-life expiry and FK mapping

import { describe, test, expect } from 'vitest';
import { pantryRoutes } from '../routes/pantry.js';
import { pgError } from './db-mock.js';
import { FRESH_ROW, INGREDIENT_ID, makeWriteMock } from './pantry-test-helpers.js';

describe('pantryRoutes', () => {
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
    // Same shape as a read: the ingredient was already loaded for the
    // shelf-life check, so the client never has to fetch it separately.
    expect(body.ingredient.name).toBe('Salmon fillet');
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
});
