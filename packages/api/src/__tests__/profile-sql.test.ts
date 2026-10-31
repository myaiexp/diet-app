// Real-Postgres smoke: profile read and PATCH

import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

describe.skipIf(!hasDb)('GET /api/profile', () => {
  test('returns user profile', async () => {
    const res = await app!.request('/api/profile');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(Array.isArray(body.dislikedIngredientIds)).toBe(true);
  });
});

describe.skipIf(!hasDb)('PATCH /api/profile', () => {
  test('updates householdSize on real DB and restores', async () => {
    const getRes = await app!.request('/api/profile');
    expect(getRes.status).toBe(200);
    const before = await getRes.json();
    const originalSize = before.householdSize as number;
    const nextSize = originalSize === 1 ? 2 : 1;

    try {
      const patchRes = await app!.request('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdSize: nextSize }),
      });
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.householdSize).toBe(nextSize);
      expect(Array.isArray(patched.dislikedIngredientIds)).toBe(true);
    } finally {
      const restore = await app!.request('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdSize: originalSize }),
      });
      expect(restore.status).toBe(200);
      expect((await restore.json()).householdSize).toBe(originalSize);
    }
  });
});
