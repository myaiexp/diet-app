// Mock-based route tests for mealPlansRoutes — deterministic, Postgres-free.
// Replaces the integration suite's always-empty assertion (a past, unseeded
// week is trivially an array): here a pre-set week of rows is returned and the
// entries — with date/slot/status — are asserted to come back.

import { describe, test, expect } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';

const ENTRIES = [
  { id: '11111111-1111-1111-1111-111111111111', date: '2026-03-02', slot: 'dinner', status: 'planned' },
  { id: '22222222-2222-2222-2222-222222222222', date: '2026-03-05', slot: 'lunch', status: 'cooked' },
];

// The handler calls db.select().from(mealPlanEntries).where(...); the chain is
// mocked to resolve to the supplied rows regardless of the (real) where clause.
function mockDbReturning(rows: unknown[]) {
  return { select: () => ({ from: () => ({ where: async () => rows }) }) } as any;
}

describe('mealPlansRoutes', () => {
  test('GET /week/:date returns the week entries with date/slot/status', async () => {
    const app = mealPlansRoutes(mockDbReturning(ENTRIES));
    const res = await app.request('/week/2026-03-05');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    for (const entry of body) {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('slot');
      expect(entry).toHaveProperty('status');
    }
    expect(body.map((e: any) => e.slot)).toEqual(['dinner', 'lunch']);
  });

  test('GET /week/:date returns an empty array for a week with no entries', async () => {
    const app = mealPlansRoutes(mockDbReturning([]));
    const res = await app.request('/week/2026-03-05');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('GET /week/:date returns 400 for a malformed date without touching the db', async () => {
    let queried = false;
    const db = { select: () => { queried = true; return { from: () => ({ where: async () => [] }) }; } } as any;
    const app = mealPlansRoutes(db);
    for (const bad of ['foo', '2026-02-30', '2026-13-01', '03-05-2026']) {
      const res = await app.request(`/week/${bad}`);
      expect(res.status, `expected 400 for "${bad}"`).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid date format' });
    }
    expect(queried).toBe(false);
  });
});
