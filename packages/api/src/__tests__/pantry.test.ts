// pantryRoutes reads: list ordering, paging and GET /:id
//
// computeStatus has its own suite in pantry-status.test.ts.

import { describe, test, expect } from 'vitest';
import { asc } from 'drizzle-orm';
import { pantryItems } from '@diet-app/db';
import { pantryRoutes } from '../routes/pantry.js';
import { DEFAULT_LIMIT } from '../pagination.js';
import {
  EXPIRED_ROW,
  FRESH_ROW,
  INGREDIENT,
  ITEM_ID,
  makeListMock,
} from './pantry-test-helpers.js';

describe('pantryRoutes', () => {
  test('GET / maps each row to a computed status field', async () => {
    const { db } = makeListMock([FRESH_ROW, EXPIRED_ROW]);
    const app = pantryRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].status).toBe('fresh');
    expect(body[1].status).toBe('expired');
  });

  test('GET / applies default pagination', async () => {
    const { db, calls } = makeListMock([FRESH_ROW]);
    await pantryRoutes(db).request('/');
    expect(calls.args?.['limit']).toBe(DEFAULT_LIMIT);
    expect(calls.args?.['offset']).toBe(0);
  });

  // Finding #5450: PATCH /pantry/:id rewrites rows in place, so paging this
  // list without a total order can hand the client the same item twice and
  // never show another. Spoilage-first ordering also matches the app's framing.
  test('GET / orders by expiry with an id tie-break before paging', async () => {
    const { db, calls } = makeListMock([FRESH_ROW]);
    await pantryRoutes(db).request('/');
    expect(calls.args?.['orderBy']).toEqual([
      asc(pantryItems.expiresDate),
      asc(pantryItems.id),
    ]);
  });

  // A pantry row carries only an ingredientId; every client needs the name.
  // Without the join, rendering a 50-row page costs 50 follow-up requests —
  // a cost that grows with the pantry, so it belongs in the query.
  test('GET / eager-loads the ingredient rather than leaving an N+1 to the client', async () => {
    const { db, calls } = makeListMock([{ ...FRESH_ROW, ingredient: INGREDIENT }]);
    const res = await pantryRoutes(db).request('/');
    expect(calls.args?.['with']).toEqual({ ingredient: true });
    expect((await res.json())[0].ingredient.name).toBe('Salmon fillet');
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
    const res = await app.request(`/${ITEM_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(FRESH_ROW.id);
    expect(body.status).toBe('fresh');
  });

  test('GET /:id returns 404 with error body when missing', async () => {
    const mockDb = { query: { pantryItems: { findFirst: async () => undefined } } } as any;
    const app = pantryRoutes(mockDb);
    const res = await app.request('/22222222-2222-4222-8222-222222222222');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
