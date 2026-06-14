// UUID param validation for the ingredients :id route (audit #1388).
// Deliberately DB-free: a mock db is passed in, and malformed ids are rejected
// with 400 BEFORE any DB query runs, so these tests never open a connection.

import { describe, test, expect } from 'vitest';
import { ingredientsRoutes } from '../routes/ingredients.js';
import { isUuid } from '../validation.js';

describe('isUuid', () => {
  test('accepts a well-formed UUID', () => {
    expect(isUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  test('accepts the nil UUID (preserves existing 404-for-missing behavior)', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  test('rejects a non-UUID string', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  test('rejects a UUID with a wrong-length segment', () => {
    expect(isUuid('a1b2c3d4-e5f6-789-abcd-ef1234567890')).toBe(false);
  });

  test('rejects a numeric id', () => {
    expect(isUuid('12345')).toBe(false);
  });
});

describe('GET /api/ingredients/:id — UUID validation', () => {
  // Empty mock db: if validation works, no db method is ever touched.
  const mockDb = {} as any;
  const app = ingredientsRoutes(mockDb);

  test('rejects a malformed :id with 400 before touching the DB', async () => {
    const res = await app.request('/not-a-uuid');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('rejects a numeric :id with 400', async () => {
    const res = await app.request('/12345');
    expect(res.status).toBe(400);
  });
});
