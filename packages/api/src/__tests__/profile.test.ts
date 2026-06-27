// Mock-based route tests for profileRoutes — deterministic, Postgres-free.
// Covers the 404 branch (empty DB), which the seed-dependent integration test
// in routes.test.ts never exercises.

import { describe, test, expect } from 'vitest';
import { profileRoutes } from '../routes/profile.js';

const PROFILE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Mase',
  calorieTargetMin: 2000,
  calorieTargetMax: 2400,
};

describe('profileRoutes', () => {
  test('GET / returns 200 with the profile when one exists', async () => {
    const mockDb = { query: { userProfile: { findFirst: async () => PROFILE } } } as any;
    const app = profileRoutes(mockDb);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PROFILE);
  });

  test('GET / returns 404 with error body when no profile exists', async () => {
    const mockDb = { query: { userProfile: { findFirst: async () => undefined } } } as any;
    const app = profileRoutes(mockDb);
    const res = await app.request('/');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
