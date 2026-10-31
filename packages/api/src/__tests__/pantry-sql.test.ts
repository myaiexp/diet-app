// Real-Postgres smoke: pantry list status and the write cycle

import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

describe.skipIf(!hasDb)('GET /api/pantry', () => {
  test('returns array with status field', async () => {
    const res = await app!.request('/api/pantry');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const validStatuses = ['fresh', 'use_soon', 'use_today', 'expired'];
    for (const item of body) {
      expect(validStatuses).toContain(item.status);
    }
  });
});

describe.skipIf(!hasDb)('pantry write cycle', () => {
  test('resolve ingredient → POST → GET → PATCH → DELETE', async () => {
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let itemId: string | undefined;
    try {
      const createRes = await app!.request('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          quantity: 2,
          unit: 'pcs',
          location: 'fridge',
          expiresDate: '2099-12-31',
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      itemId = created.id;
      expect(created.status).toBeDefined();
      expect(created.quantity).toBe('2');

      const getRes = await app!.request(`/api/pantry/${itemId}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).id).toBe(itemId);

      const patchRes = await app!.request(`/api/pantry/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 5, unit: 'pcs' }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).quantity).toBe('5');
    } finally {
      if (itemId) {
        const delRes = await app!.request(`/api/pantry/${itemId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRes.status);
      }
    }
  });
});
