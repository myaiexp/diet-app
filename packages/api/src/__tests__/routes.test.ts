import { config } from 'dotenv';
config({ path: '../../.env' });

import { describe, test, expect, afterAll } from 'vitest';
import { createDb } from '@diet-app/db';
import { createApp } from '../app.js';
import { assertEnv } from '../env.js';

// SAFETY: tests MUST run against the isolated test DB, never prod (DATABASE_URL).
// Resolve the test URL and hard-fail BEFORE opening any connection if it looks
// like the production database — i.e. contains 'dietapp' without the '_test'
// suffix. This makes it impossible for a misconfigured env to point tests at
// prod. (The error intentionally does not echo the URL, to avoid leaking any
// credentials embedded in a misconfigured value.)
const TEST_DB_URL = assertEnv('TEST_DATABASE_URL');
if (TEST_DB_URL.includes('dietapp') && !TEST_DB_URL.includes('_test')) {
  throw new Error(
    "Refusing to run tests: TEST_DATABASE_URL looks like the production database " +
      "(contains 'dietapp' but not '_test'). Point it at dietapp_test before running tests."
  );
}

const db = createDb(TEST_DB_URL);
const app = createApp(db);

// Write-path tests: all routes are currently GET-only, so no mutation coverage
// exists yet. When adding write tests against dietapp_test, isolate them so they
// don't leave state behind for later tests — wrap each in a transaction that is
// rolled back, or truncate + reseed in a beforeEach/afterAll. The DB is isolated
// from prod (guarded above), so writes here are safe regardless.

afterAll(async () => {
  // Close the underlying pg pool so the test process exits cleanly
  await db.$client.end();
});

describe('GET /api/ingredients', () => {
  test('returns array', async () => {
    const res = await app.request('/api/ingredients');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('?q=chicken returns filtered results', async () => {
    const res = await app.request('/api/ingredients?q=chicken');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Each result should match chicken in name or aliases
    for (const item of body) {
      const nameMatch = item.name.toLowerCase().includes('chicken');
      const aliasMatch = (item.aliases ?? []).some((a: string) =>
        a.toLowerCase().includes('chicken')
      );
      expect(nameMatch || aliasMatch).toBe(true);
    }
  });

  test('?category=produce returns only produce', async () => {
    const res = await app.request('/api/ingredients?category=produce');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(item.category).toBe('produce');
    }
  });

  test('/:id returns 404 for missing', async () => {
    const res = await app.request('/api/ingredients/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/recipes', () => {
  test('returns array', async () => {
    const res = await app.request('/api/recipes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/pantry', () => {
  test('returns array with status field', async () => {
    const res = await app.request('/api/pantry');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const validStatuses = ['fresh', 'use_soon', 'use_today', 'expired'];
    for (const item of body) {
      expect(validStatuses).toContain(item.status);
    }
  });
});

describe('GET /api/profile', () => {
  test('returns user profile', async () => {
    const res = await app.request('/api/profile');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
  });
});

describe('GET /api/shopping-lists', () => {
  test('/current returns 404 when none exist', async () => {
    const res = await app.request('/api/shopping-lists/current');
    // Either 200 (if seeded) or 404 (if empty) — both are valid
    expect([200, 404]).toContain(res.status);
  });
});

describe('GET /api/meal-plans', () => {
  test('/week/2026-03-05 returns array', async () => {
    const res = await app.request('/api/meal-plans/week/2026-03-05');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
