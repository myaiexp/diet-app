// Mock-based route tests for pantryRoutes (computeStatus has its own suite in
// pantry-status.test.ts).

import { describe, test, expect } from 'vitest';
import { pantryRoutes } from '../routes/pantry.js';
import { makeSelectMock } from './select-mock.js';
import { DEFAULT_LIMIT } from '../pagination.js';

// Mock-based route tests for pantryRoutes — deterministic, Postgres-free.
// The GET handlers use the real `new Date()`, so far-future / far-past expiry
// dates keep computeStatus deterministic on any run date and in any timezone.
const FRESH_ROW = { id: '11111111-1111-1111-1111-111111111111', expiresDate: '2099-12-31' };
const EXPIRED_ROW = { id: '22222222-2222-2222-2222-222222222222', expiresDate: '2000-01-01' };

describe('pantryRoutes', () => {
  test('GET / maps each row to a computed status field', async () => {
    const { db } = makeSelectMock([FRESH_ROW, EXPIRED_ROW]);
    const app = pantryRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].status).toBe('fresh');
    expect(body[1].status).toBe('expired');
  });

  test('GET / applies default pagination', async () => {
    const { db, calls } = makeSelectMock([FRESH_ROW]);
    await pantryRoutes(db).request('/');
    expect(calls.limit).toBe(DEFAULT_LIMIT);
    expect(calls.offset).toBe(0);
  });

  test('GET /:id rejects a malformed id with 400 before touching the DB', async () => {
    const app = pantryRoutes({} as any);
    const res = await app.request('/not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  test('GET /:id returns 200 with a computed status field when found', async () => {
    const mockDb = { query: { pantryItems: { findFirst: async () => FRESH_ROW } } } as any;
    const app = pantryRoutes(mockDb);
    const res = await app.request('/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(FRESH_ROW.id);
    expect(body.status).toBe('fresh');
  });

  test('GET /:id returns 404 with error body when missing', async () => {
    const mockDb = { query: { pantryItems: { findFirst: async () => undefined } } } as any;
    const app = pantryRoutes(mockDb);
    const res = await app.request('/22222222-2222-2222-2222-222222222222');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
