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

function setup() {
  const mock = makeDbMock({
    updateRows: mergedRow(ROW),
    query: {
      pantryItems: { findFirst: vi.fn(async () => ({ ...ROW, ingredient: { name: 'Flour' } })) },
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
