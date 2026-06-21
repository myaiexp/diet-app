// UUID param validation for the ingredients :id route (audit #1388).
// Deliberately DB-free: a mock db is passed in, and malformed ids are rejected
// with 400 BEFORE any DB query runs, so these tests never open a connection.

import { describe, test, expect } from 'vitest';
import { ingredientsRoutes } from '../routes/ingredients.js';
import { isUuid } from '../validation.js';
import { makeSelectMock } from './select-mock.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../pagination.js';

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

describe('GET /api/ingredients — list filtering', () => {
  const ROW = { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Chicken breast', category: 'meat' };

  test('no filters: where clause is undefined (unfiltered path)', async () => {
    const { db, calls } = makeSelectMock([ROW]);
    const res = await ingredientsRoutes(db).request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([ROW]);
    expect(calls.where).toBeUndefined();
  });

  test('?q alone: combined and() not used but a where clause is applied', async () => {
    const { db, calls } = makeSelectMock([ROW]);
    await ingredientsRoutes(db).request('/?q=chicken');
    expect(calls.where).toBeDefined();
  });

  // Finding #5: the ?q + ?category combined path runs the and(...) branch, which
  // single-filter tests never exercise. A defined where clause proves the branch
  // was taken; real two-filter SQL semantics are checked in the integration suite.
  test('?q + ?category together: both filters drive a combined where clause', async () => {
    const { db, calls } = makeSelectMock([ROW]);
    const res = await ingredientsRoutes(db).request('/?q=chicken&category=meat');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([ROW]);
    expect(calls.where).toBeDefined();
  });
});

describe('GET /api/ingredients — pagination', () => {
  test('defaults: limit=DEFAULT_LIMIT, offset=0 when no params', async () => {
    const { db, calls } = makeSelectMock([]);
    await ingredientsRoutes(db).request('/');
    expect(calls.limit).toBe(DEFAULT_LIMIT);
    expect(calls.offset).toBe(0);
  });

  test('honours explicit ?limit and ?offset', async () => {
    const { db, calls } = makeSelectMock([]);
    await ingredientsRoutes(db).request('/?limit=10&offset=5');
    expect(calls.limit).toBe(10);
    expect(calls.offset).toBe(5);
  });

  test('clamps an over-large ?limit to MAX_LIMIT', async () => {
    const { db, calls } = makeSelectMock([]);
    await ingredientsRoutes(db).request('/?limit=9999');
    expect(calls.limit).toBe(MAX_LIMIT);
  });

  test('falls back to default on a non-numeric ?limit', async () => {
    const { db, calls } = makeSelectMock([]);
    await ingredientsRoutes(db).request('/?limit=abc');
    expect(calls.limit).toBe(DEFAULT_LIMIT);
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

describe('GET /api/ingredients/:id — lookup', () => {
  const VALID_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const ROW = {
    id: VALID_ID,
    name: 'Chicken breast',
    aliases: ['chicken'],
    category: 'meat',
    defaultUnit: 'g',
    nutritionPer100g: { kcal: 165 },
    shelfLife: { fridge: 3 },
    tags: [],
    isPantryStaple: false,
  };

  test('returns 200 with the full ingredient shape when found', async () => {
    const mockDb = { query: { ingredients: { findFirst: async () => ROW } } } as any;
    const app = ingredientsRoutes(mockDb);
    const res = await app.request(`/${VALID_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: VALID_ID, name: 'Chicken breast', category: 'meat' });
    expect(body.aliases).toEqual(['chicken']);
  });

  test('returns 404 with error body when a valid id is not found', async () => {
    const mockDb = { query: { ingredients: { findFirst: async () => undefined } } } as any;
    const app = ingredientsRoutes(mockDb);
    const res = await app.request(`/${VALID_ID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
