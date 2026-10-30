// Mock-based pantry PATCH rules: which body fields become column writes

import { describe, test, expect, vi } from 'vitest';
import { pantryRoutes } from '../routes/pantry.js';
import { makeDbMock, mergedRow } from './db-mock.js';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const ROW = {
  id: ITEM_ID,
  ingredientId: '22222222-2222-4222-8222-222222222222',
  quantity: '2',
  unit: 'kg',
  location: 'fridge',
  addedDate: '2026-07-01',
  expiresDate: '2099-12-31',
  opened: false,
};

function setup(row: Partial<typeof ROW> = {}) {
  const existing = { ...ROW, ...row };
  const mock = makeDbMock({
    updateRows: mergedRow(existing),
    query: {
      pantryItems: { findFirst: vi.fn(async () => ({ ...existing, ingredient: { name: 'Flour' } })) },
    },
  });
  const patch = (body: unknown) =>
    pantryRoutes(mock.db).request(`/${ITEM_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { patch, updates: mock.updates };
}

describe('PATCH /pantry/:id expectedQuantity', () => {
  test('is refused without a quantity to guard', async () => {
    const { patch, updates } = setup();
    const res = await patch({ expectedQuantity: 2, location: 'freezer' });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test('is never written as a column', async () => {
    const { patch, updates } = setup();
    const res = await patch({ quantity: 5, expectedQuantity: 2 });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ quantity: '5' });
    expect(updates[0]).not.toHaveProperty('expectedQuantity');
  });
});

describe('pantry units', () => {
  async function post(unit: string) {
    const mock = makeDbMock({
      insertRows: mergedRow(ROW),
      query: { ingredients: { findFirst: vi.fn(async () => ({ id: ROW.ingredientId, shelfLife: {} })) } },
    });
    return pantryRoutes(mock.db).request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: ROW.ingredientId,
        quantity: 1,
        unit,
        location: 'fridge',
        expiresDate: '2099-12-31',
      }),
    });
  }

  test('POST refuses a unit units.ts cannot resolve, naming the known ones', async () => {
    const res = await post('bag');
    expect(res.status).toBe(400);
    const { fieldErrors } = (await res.json()).details;
    expect(fieldErrors.unit[0]).toContain('kpl');
  });

  test('POST accepts a known unit in any case and spelling', async () => {
    expect((await post(' KG ')).status).toBe(201);
    expect((await post('rkl')).status).toBe(201);
  });

  test('PATCH refuses an unknown unit and writes nothing', async () => {
    const { patch, updates } = setup();
    const res = await patch({ unit: 'bag' });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test('a unit-only PATCH rescales: 2 kg to g writes 2000', async () => {
    const { patch, updates } = setup();
    const res = await patch({ unit: 'g' });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ quantity: '2000', unit: 'g' });
  });

  test('a unit-only PATCH across dimensions is a 400, because no factor exists', async () => {
    const { patch, updates } = setup();
    const res = await patch({ unit: 'l' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('kg');
    expect(updates).toHaveLength(0);
  });

  test('quantity and unit together are taken literally, across dimensions too', async () => {
    const { patch, updates } = setup();
    const res = await patch({ quantity: 3, unit: 'l' });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ quantity: '3', unit: 'l' });
  });

  test('a rescale that rounds to zero is refused rather than stored', async () => {
    const { patch, updates } = setup({ quantity: '0.0000001', unit: 'g' });
    const res = await patch({ unit: 'kg' });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test('a rescale past the quantity cap is refused rather than stored', async () => {
    const { patch, updates } = setup({ quantity: '2000', unit: 'kg' });
    const res = await patch({ unit: 'g' });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
