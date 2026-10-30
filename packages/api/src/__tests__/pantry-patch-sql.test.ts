// Real-SQL pantry PATCH guards: the compare-and-set a stale edit dialog runs into

import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

async function patch(id: string, body: unknown) {
  return app!.request(`/api/pantry/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function withItem(
  fields: { quantity: number; unit: string },
  run: (id: string) => Promise<void>,
) {
  const ingredients = await (await app!.request('/api/ingredients?limit=1')).json();
  const created = await app!.request('/api/pantry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingredientId: ingredients[0].id,
      ...fields,
      location: 'fridge',
      expiresDate: '2099-12-31',
    }),
  });
  expect(created.status).toBe(201);
  const id = (await created.json()).id as string;
  try {
    await run(id);
  } finally {
    await app!.request(`/api/pantry/${id}`, { method: 'DELETE' });
  }
}

describe.skipIf(!hasDb)('pantry PATCH expectedQuantity', () => {
  test('writes when the stored quantity still matches, numerically', async () => {
    await withItem({ quantity: 1.5, unit: 'kg' }, async (id) => {
      const res = await patch(id, { quantity: 2, expectedQuantity: 1.5 });
      expect(res.status).toBe(200);
      expect((await res.json()).quantity).toBe('2');
    });
  });

  test('409s and writes nothing when the quantity moved under the dialog', async () => {
    await withItem({ quantity: 500, unit: 'g' }, async (id) => {
      const moved = await patch(id, { quantity: 300 }); // what a cook commit leaves behind
      expect(moved.status).toBe(200);

      const stale = await patch(id, { quantity: 450, expectedQuantity: 500, location: 'freezer' });
      expect(stale.status).toBe(409);

      const row = await (await app!.request(`/api/pantry/${id}`)).json();
      expect(row.quantity).toBe('300');
      expect(row.location).toBe('fridge');
    });
  });

  test('404s, not 409s, when the row is gone', async () => {
    await withItem({ quantity: 500, unit: 'g' }, async (id) => {
      await app!.request(`/api/pantry/${id}`, { method: 'DELETE' });
      const res = await patch(id, { quantity: 450, expectedQuantity: 500 });
      expect(res.status).toBe(404);
    });
  });
});
